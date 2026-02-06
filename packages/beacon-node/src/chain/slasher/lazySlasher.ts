// Note: isSlashableAttestationData from state-transition uses bigint types
// We do manual epoch comparison to avoid type conversion overhead
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
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
    logger: Logger,
    db: IBeaconDb,
    _metrics: Metrics | null,
    opPool: OpPool | null = null
  ) {
    this.config = {...defaultLazySlasherConfig, ...config};
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
    const slashings = await this.verifyAndFindSlashings(checkResult, indexedAttestation);

    if (slashings.length === 0) {
      this.internalMetrics.falsePositives++;
    } else {
      this.internalMetrics.slashingsFound += slashings.length;
      this.logger.info("Slashings found!", {count: slashings.length});

      // Insert found slashings into opPool for inclusion in blocks
      if (this.opPool && this.config.broadcastSlashings) {
        for (const slashing of slashings) {
          try {
            // Use electra fork for modern slashings
            this.opPool.insertAttesterSlashing(ForkName.electra, slashing);
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
      return {
        type: "surrounds",
        triggerAttestation: record,
        surroundedTargetEpoch: minTarget,
        searchEpochs: [minTarget, minTarget + 1],
      };
    }

    // Check if this attestation is surrounded by something
    // a=(s,t) is surrounded by a'=(s',t') if s' < s and t < t'
    // Using aggregate: if t < M(s), there exists some a' that might surround this
    const maxTarget = this.state.maxTargetBySource.get(sourceEpoch);
    if (maxTarget !== undefined && targetEpoch < maxTarget) {
      return {
        type: "surrounded",
        triggerAttestation: record,
        surroundingTargetEpoch: maxTarget,
        searchEpochs: [targetEpoch, targetEpoch + 1],
      };
    }

    return {type: "none"};
  }

  /**
   * Update aggregate min-max state with a new attestation.
   */
  private updateAggregates(record: AttestationRecord): void {
    const {sourceEpoch, targetEpoch} = record;

    // Update m(i) for all epochs i where source > i
    // This attestation with source=s could be surrounded by future attestations with source < s
    // So we need to track: for any future att with source=i (where i < s), this att's target
    // m(i) = min target where source > i
    // When we see (s, t), we potentially update m(i) for i < s
    // But we can't iterate all - instead, we note that m(s-1) should consider t
    // Actually, the definition is: m(i) = min{t : (s,t) in A, s > i}
    // For the new attestation (s,t), it contributes to m(i) for all i < s

    // Efficient update: only update if this is a new minimum for the relevant bucket
    // For epochs i where i < sourceEpoch, this attestation's target might be the new minimum
    // We store m(sourceEpoch - 1) and compare
    for (let i = 0; i < sourceEpoch && i >= this.currentEpoch - this.config.historyLength; i++) {
      const current = this.state.minTargetBySource.get(i);
      if (current === undefined || targetEpoch < current) {
        this.state.minTargetBySource.set(i, targetEpoch);
      }
    }

    // Update M(i) for all epochs i where source < i
    // M(i) = max{t : (s,t) in A, s < i}
    // For the new attestation (s,t), it contributes to M(i) for all i > s
    for (let i = sourceEpoch + 1; i <= this.currentEpoch && i <= sourceEpoch + this.config.historyLength; i++) {
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
   * Note: Full implementation requires committee reconstruction to get IndexedAttestations
   * from block attestations. This is a placeholder that detects slashable data but
   * cannot yet produce complete AttesterSlashing proofs without committee info.
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
      this.logger.debug("No blocks found in search epochs", {
        searchEpoch1,
        searchEpoch2,
      });
      return [];
    }

    // Get the validator indices from the trigger attestation for future use
    const triggerValidatorSet = new Set(Array.from(triggerAttestation.attestingIndices).map(Number));

    // Search through attestations in those blocks
    for (const block of blocks) {
      for (const blockAttestation of block.message.body.attestations) {
        // Check if attestation data could form a slashable pair
        const blockAttData = blockAttestation.data;

        // Quick check: do source/target epochs suggest a surround?
        // isSlashableAttestationData expects bigint types, so we compare epochs directly
        const blockSourceEpoch = Number(blockAttData.source.epoch);
        const blockTargetEpoch = Number(blockAttData.target.epoch);
        const triggerSourceEpoch = triggerAttestation.data.source.epoch;
        const triggerTargetEpoch = triggerAttestation.data.target.epoch;

        // Surround vote check: a surrounds b if a.source < b.source AND b.target < a.target
        const isSurround =
          (triggerSourceEpoch < blockSourceEpoch && blockTargetEpoch < triggerTargetEpoch) ||
          (blockSourceEpoch < triggerSourceEpoch && triggerTargetEpoch < blockTargetEpoch);

        // Double vote check: different data, same target epoch
        const isDoubleVote = blockTargetEpoch === triggerTargetEpoch;

        if (isSurround || isDoubleVote) {
          // Found potentially slashable attestation data
          // Full implementation would reconstruct IndexedAttestation from committee
          // and check validator overlap with triggerValidatorSet
          this.logger.debug("Found potentially slashable attestation data", {
            blockSlot: block.message.slot,
            blockSource: blockSourceEpoch,
            blockTarget: blockTargetEpoch,
            triggerSource: triggerSourceEpoch,
            triggerTarget: triggerTargetEpoch,
            type: isSurround ? "surround" : "double-vote",
            triggerValidatorCount: triggerValidatorSet.size,
          });

          // TODO: Reconstruct IndexedAttestation from committee and create AttesterSlashing
          // This requires access to historical state/shuffling data
        }
      }
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
