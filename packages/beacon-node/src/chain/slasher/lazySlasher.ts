// Note: isSlashableAttestationData from state-transition uses bigint types
// We do manual epoch comparison to avoid type conversion overhead
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {AttesterSlashing, Epoch, IndexedAttestation, SignedBeaconBlock, ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import type {IBeaconDb} from "../../db/interface.js";
import type {Metrics} from "../../metrics/metrics.js";
import {OpPool} from "../opPools/opPool.js";
import {
  AggregateMinMax,
  AttestationRecord,
  LazySlasherConfig,
  LazySlasherMetrics,
  SurroundCheckResult,
  defaultLazySlasherConfig,
} from "./types.js";

/**
 * Lazy Slasher - Lightweight slashing detection using aggregate min-max functions.
 *
 * Instead of maintaining per-validator attestation history (requiring gigabytes of storage),
 * this slasher keeps aggregate min-max values that can detect *potential* slashable offenses,
 * then verifies on-demand by fetching relevant historical blocks.
 *
 * Storage: O(historyLength) ≈ 65KB vs O(validators × historyLength) ≈ gigabytes
 *
 * Trade-off: Potential false positives that require verification, but most nodes can now
 * participate in slashing detection.
 *
 * @see https://ethresear.ch/t/a-lazy-approach-to-slashers/22041
 */
export class LazySlasher {
  private readonly config: LazySlasherConfig;
  private readonly beaconConfig: BeaconConfig;
  private readonly logger: Logger;
  private readonly db: IBeaconDb;
  private readonly opPool: OpPool | null;

  /** Aggregate min-max state */
  private readonly state: AggregateMinMax;

  /** Internal metrics tracking */
  private readonly internalMetrics: LazySlasherMetrics;

  /** Current epoch (updated externally) */
  private currentEpoch: Epoch = 0;

  constructor(
    config: Partial<LazySlasherConfig>,
    beaconConfig: BeaconConfig,
    logger: Logger,
    db: IBeaconDb,
    _metrics: Metrics | null,
    opPool: OpPool | null = null
  ) {
    this.config = {...defaultLazySlasherConfig, ...config};
    this.beaconConfig = beaconConfig;
    // Logger in production is a LoggerNode with `.child()`, but the Logger type does not expose it
    this.logger = ((logger as any).child?.({module: "lazy-slasher"}) as Logger) ?? logger;
    this.db = db;
    this.opPool = opPool;

    this.state = {
      minTargetBySource: new Map(),
      maxTargetBySource: new Map(),
    };

    this.internalMetrics = {
      attestationsProcessed: 0,
      surroundChecksTriggered: 0,
      slashingsFound: 0,
      falsePositives: 0,
      minTargetMapSize: 0,
      maxTargetMapSize: 0,
    };

    this.logger.info("Lazy slasher initialized", {
      enabled: this.config.enabled,
      historyLength: this.config.historyLength,
    });
  }

  /**
   * Update the current epoch. Should be called on epoch transitions.
   */
  setCurrentEpoch(epoch: Epoch): void {
    this.currentEpoch = epoch;
    this.pruneOldEpochs();
  }

  /**
   * Process an attestation for potential slashing detection.
   * This is the main entry point - call for every attestation seen.
   *
   * @returns Array of slashing candidates if any detected (on-demand verification needed)
   */
  async processAttestation(indexedAttestation: IndexedAttestation): Promise<AttesterSlashing[]> {
    if (!this.config.enabled) {
      return [];
    }

    const record = this.toAttestationRecord(indexedAttestation);
    this.internalMetrics.attestationsProcessed++;

    // Check for potential surrounds using aggregate functions
    const checkResult = this.checkForSurrounds(record);

    // Update aggregate state with this attestation
    this.updateAggregates(record);

    // If no potential surround detected, we're done
    if (checkResult.type === "none") {
      return [];
    }

    this.internalMetrics.surroundChecksTriggered++;
    this.logger.debug("Potential surround detected, verifying", {
      type: checkResult.type,
      sourceEpoch: record.sourceEpoch,
      targetEpoch: record.targetEpoch,
      searchEpoch1: checkResult.searchEpochs[0],
      searchEpoch2: checkResult.searchEpochs[1],
    });

    // On-demand verification: fetch historical blocks and find actual slashings
    // Note: falsePositives are tracked inside verifyAndFindSlashings
    const slashings = await this.verifyAndFindSlashings(checkResult, indexedAttestation);

    if (slashings.length > 0) {
      this.internalMetrics.slashingsFound += slashings.length;
      this.logger.info("Slashings found!", {count: slashings.length});

      // Insert found slashings into opPool for inclusion in blocks
      if (this.opPool && this.config.broadcastSlashings) {
        for (const slashing of slashings) {
          try {
            // Use fork at attestation slot for proper serialization
            const fork = this.beaconConfig.getForkName(Number(slashing.attestation1.data.slot));
            this.opPool.insertAttesterSlashing(fork, slashing);
            this.logger.info("Inserted attester slashing into opPool", {
              slashableCount: slashing.attestation1.attestingIndices.length,
            });
          } catch (e) {
            this.logger.warn("Failed to insert attester slashing", {}, e as Error);
          }
        }
      }
    }

    return slashings;
  }

  /**
   * Process all attestations in a block.
   * Note: Block attestations require committee info to convert to IndexedAttestation.
   * For now, we rely primarily on gossip-based attestation processing.
   */
  async processBlock(_signedBlock: SignedBeaconBlock): Promise<AttesterSlashing[]> {
    if (!this.config.enabled) {
      return [];
    }

    // Block attestations are already included on-chain and validated.
    // The lazy slasher is most effective when processing gossip attestations
    // before they're included in blocks, allowing early slashing detection.
    // Future enhancement: could reconstruct IndexedAttestations from block
    // if we have committee data available.
    return [];
  }

  /**
   * Check if an attestation potentially creates a surround situation.
   * Uses aggregate min-max - may have false positives.
   */
  private checkForSurrounds(record: AttestationRecord): SurroundCheckResult {
    const {sourceEpoch, targetEpoch} = record;

    // Check if this attestation surrounds something
    // a=(s,t) surrounds a'=(s',t') if s < s' and t' < t
    // Using aggregate: if t > m(s), there exists some a' that might be surrounded
    const minTarget = this.state.minTargetBySource.get(sourceEpoch);
    if (minTarget !== undefined && targetEpoch > minTarget) {
      // Search range: attestations can be included up to 1 epoch after their target
      // so we search [minTarget, minTarget + 2) to catch inclusion delays
      return {
        type: "surrounds",
        triggerAttestation: record,
        surroundedTargetEpoch: minTarget,
        searchEpochs: [minTarget, minTarget + 2],
      };
    }

    // Check if this attestation is surrounded by something
    // a=(s,t) is surrounded by a'=(s',t') if s' < s and t < t'
    // Using aggregate: if t < M(s), there exists some a' that might surround this
    const maxTarget = this.state.maxTargetBySource.get(sourceEpoch);
    if (maxTarget !== undefined && targetEpoch < maxTarget) {
      // Search range extended for inclusion delays
      return {
        type: "surrounded",
        triggerAttestation: record,
        surroundingTargetEpoch: maxTarget,
        searchEpochs: [targetEpoch, targetEpoch + 2],
      };
    }

    return {type: "none"};
  }

  /**
   * Update aggregate min-max state with a new attestation.
   *
   * Performance: We limit updates to `updateWindow` recent epochs to avoid O(historyLength)
   * iterations per attestation. This is a trade-off: very old slashings might be missed,
   * but the common case (slashings within a few epochs) is covered efficiently.
   *
   * IMPORTANT: For M(i), we must update beyond currentEpoch because future attestations
   * may have source > currentEpoch. If we only update up to currentEpoch, we'd miss
   * detecting when those future attestations are surrounded by this one.
   */
  private updateAggregates(record: AttestationRecord): void {
    const {sourceEpoch, targetEpoch} = record;

    // Calculate the window of epochs we'll update
    // For m(i): epochs in [max(0, sourceEpoch - updateWindow), sourceEpoch)
    // For M(i): epochs in (sourceEpoch, sourceEpoch + updateWindow]
    //   Note: M(i) is NOT capped at currentEpoch - we need to cover future source epochs
    const windowStart = Math.max(0, sourceEpoch - this.config.updateWindow);

    // Update m(i) for epochs i in our update window where i < sourceEpoch
    // m(i) = min{t : (s,t) in A, s > i}
    // For the new attestation (s,t), it contributes to m(i) for all i < s
    for (let i = windowStart; i < sourceEpoch; i++) {
      const current = this.state.minTargetBySource.get(i);
      if (current === undefined || targetEpoch < current) {
        this.state.minTargetBySource.set(i, targetEpoch);
      }
    }

    // Update M(i) for epochs i in our update window where i > sourceEpoch
    // M(i) = max{t : (s,t) in A, s < i}
    // For the new attestation (s,t), it contributes to M(i) for all i > s
    // NOT capped at currentEpoch: future attestations with source in this range need M(source) populated
    const maxWindowEnd = sourceEpoch + this.config.updateWindow;
    for (let i = sourceEpoch + 1; i <= maxWindowEnd; i++) {
      const current = this.state.maxTargetBySource.get(i);
      if (current === undefined || targetEpoch > current) {
        this.state.maxTargetBySource.set(i, targetEpoch);
      }
    }

    this.internalMetrics.minTargetMapSize = this.state.minTargetBySource.size;
    this.internalMetrics.maxTargetMapSize = this.state.maxTargetBySource.size;
  }

  /**
   * Verify a potential surround by fetching historical blocks and checking validators.
   *
   * CURRENT LIMITATION: Full implementation requires committee reconstruction to convert
   * block attestations into IndexedAttestations (which have explicit validator indices).
   * Block attestations only contain aggregation bits, not validator indices.
   *
   * To complete this, we would need:
   * 1. Historical beacon state at the attestation slot
   * 2. Committee shuffling to map aggregation bits → validator indices
   * 3. Intersection check between trigger and historical attestation validators
   *
   * For now, this function detects *potential* slashable data and logs it for monitoring.
   * A complete implementation would need to integrate with state replay or maintain
   * committee caches for historical epochs.
   *
   * @returns Empty array currently - slashings are logged but not yet returned
   */
  private async verifyAndFindSlashings(
    checkResult: Exclude<SurroundCheckResult, {type: "none"}>,
    triggerAttestation: IndexedAttestation
  ): Promise<AttesterSlashing[]> {
    const slashings: AttesterSlashing[] = [];
    const [searchEpoch1, searchEpoch2] = checkResult.searchEpochs;

    // Fetch blocks from the search epochs
    const blocks = await this.fetchBlocksInEpochs([searchEpoch1, searchEpoch2]);

    if (blocks.length === 0) {
      // Could not verify - archive may be pruned. Don't count as false positive.
      this.logger.debug("No blocks found in search epochs (archive pruned?)", {
        searchEpoch1,
        searchEpoch2,
      });
      // Note: We don't increment falsePositives here - we couldn't verify either way
      return [];
    }

    // Get the validator indices from the trigger attestation
    const triggerValidatorSet = new Set(Array.from(triggerAttestation.attestingIndices).map(Number));
    let foundPotentialSlashing = false;

    // Search through attestations in those blocks
    for (const block of blocks) {
      for (const blockAttestation of block.message.body.attestations) {
        const blockAttData = blockAttestation.data;

        const blockSourceEpoch = Number(blockAttData.source.epoch);
        const blockTargetEpoch = Number(blockAttData.target.epoch);
        const triggerSourceEpoch = triggerAttestation.data.source.epoch;
        const triggerTargetEpoch = triggerAttestation.data.target.epoch;

        // Surround vote check: a surrounds b if a.source < b.source AND b.target < a.target
        const isSurround =
          (triggerSourceEpoch < blockSourceEpoch && blockTargetEpoch < triggerTargetEpoch) ||
          (blockSourceEpoch < triggerSourceEpoch && triggerTargetEpoch < blockTargetEpoch);

        // Double vote check: different data, same target epoch
        const isDoubleVote =
          blockTargetEpoch === triggerTargetEpoch &&
          toRootHex(ssz.phase0.AttestationData.hashTreeRoot(blockAttData)) !==
            toRootHex(ssz.phase0.AttestationData.hashTreeRoot(triggerAttestation.data));

        if (isSurround || isDoubleVote) {
          foundPotentialSlashing = true;
          // Log for monitoring - actual slashing creation needs committee reconstruction
          this.logger.warn("Potential slashable attestation detected (verification incomplete)", {
            blockSlot: block.message.slot,
            blockSource: blockSourceEpoch,
            blockTarget: blockTargetEpoch,
            triggerSource: triggerSourceEpoch,
            triggerTarget: triggerTargetEpoch,
            type: isSurround ? "surround" : "double-vote",
            triggerValidatorCount: triggerValidatorSet.size,
          });

          // TODO: To create actual AttesterSlashing proof:
          // 1. Get beacon state at block.message.slot
          // 2. Compute committee for blockAttestation.data.slot and index
          // 3. Map aggregation bits to validator indices
          // 4. Check intersection with triggerValidatorSet
          // 5. If overlap, create AttesterSlashing with both IndexedAttestations
        }
      }
    }

    // Only count as false positive if we searched blocks but found no potential slashings
    if (!foundPotentialSlashing) {
      this.internalMetrics.falsePositives++;
    }

    return slashings;
  }

  /**
   * Fetch blocks from specified epochs.
   */
  private async fetchBlocksInEpochs(epochs: Epoch[]): Promise<SignedBeaconBlock[]> {
    const blocks: SignedBeaconBlock[] = [];
    const seenSlots = new Set<number>();

    for (const epoch of epochs) {
      // Fetch finalized blocks in [startSlot, endSlot)
      const startSlot = epoch * SLOTS_PER_EPOCH;
      const endSlot = startSlot + SLOTS_PER_EPOCH;

      try {
        const epochBlocks = await this.db.blockArchive.values({gte: startSlot, lt: endSlot});
        for (const block of epochBlocks) {
          // Defensive de-dupe in case epochs overlap
          const slot = block.message.slot;
          if (!seenSlots.has(slot)) {
            seenSlots.add(slot);
            blocks.push(block);
          }
        }
      } catch (e) {
        this.logger.debug("Error fetching blocks for epoch", {epoch}, e as Error);
      }
    }

    return blocks;
  }

  /**
   * Prune old epochs from the aggregate state.
   */
  private pruneOldEpochs(): void {
    const cutoffEpoch = this.currentEpoch - this.config.historyLength;

    for (const [epoch] of this.state.minTargetBySource) {
      if (epoch < cutoffEpoch) {
        this.state.minTargetBySource.delete(epoch);
      }
    }

    for (const [epoch] of this.state.maxTargetBySource) {
      if (epoch < cutoffEpoch) {
        this.state.maxTargetBySource.delete(epoch);
      }
    }

    this.internalMetrics.minTargetMapSize = this.state.minTargetBySource.size;
    this.internalMetrics.maxTargetMapSize = this.state.maxTargetBySource.size;
  }

  /**
   * Convert IndexedAttestation to our internal record format.
   */
  private toAttestationRecord(att: IndexedAttestation): AttestationRecord {
    return {
      sourceEpoch: att.data.source.epoch,
      targetEpoch: att.data.target.epoch,
      slot: att.data.slot,
      dataRoot: toRootHex(ssz.phase0.AttestationData.hashTreeRoot(att.data)),
      attestingIndices: Array.from(att.attestingIndices).map(Number),
    };
  }

  /**
   * Get current metrics.
   */
  getMetrics(): LazySlasherMetrics {
    return {...this.internalMetrics};
  }

  /**
   * Get aggregate state size for monitoring.
   */
  getStateSize(): {minMapSize: number; maxMapSize: number; totalBytes: number} {
    const minMapSize = this.state.minTargetBySource.size;
    const maxMapSize = this.state.maxTargetBySource.size;
    // Each entry: epoch (8 bytes) + epoch value (8 bytes) = 16 bytes
    const totalBytes = (minMapSize + maxMapSize) * 16;

    return {minMapSize, maxMapSize, totalBytes};
  }
}
