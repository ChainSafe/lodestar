import {altair, phase0, Root, RootHex, Slot, ssz, SyncPeriod} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {
  CachedBeaconStateAltair,
  computeSyncPeriodAtEpoch,
  computeSyncPeriodAtSlot,
} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {routes} from "@chainsafe/lodestar-api";
import {BitArray, CompositeViewDU, toHexString} from "@chainsafe/ssz";
import {IBeaconDb} from "../../db";
import {IMetrics} from "../../metrics";
import {MapDef, pruneSetToMax} from "../../util/map";
import {ChainEvent, ChainEventEmitter} from "../emitter";
import {
  getNextSyncCommitteeBranch,
  getSyncCommitteesWitness,
  getFinalizedRootProof,
  getCurrentSyncCommitteeBranch,
} from "./proofs";
import {PartialLightClientUpdate} from "./types";
import {SYNC_COMMITTEE_SIZE} from "@chainsafe/lodestar-params";
import {byteArrayEquals} from "../../util/bytes";
import {ZERO_HASH} from "../../constants";

type DependantRootHex = RootHex;
type BlockRooHex = RootHex;

type SyncAttestedData = {
  attestedHeader: phase0.BeaconBlockHeader;
  /** Precomputed root to prevent re-hashing */
  blockRoot: Uint8Array;
} & (
  | {
      isFinalized: true;
      finalityBranch: Uint8Array[];
      finalizedCheckpoint: phase0.Checkpoint;
    }
  | {
      isFinalized: false;
    }
);

type LightClientServerModules = {
  config: IChainForkConfig;
  db: IBeaconDb;
  metrics: IMetrics | null;
  emitter: ChainEventEmitter;
  logger: ILogger;
};

const MAX_CACHED_FINALIZED_HEADERS = 3;
const MAX_PREV_HEAD_DATA = 32;

/**
 * Compute and cache "init" proofs as the chain advances.
 * Will compute proofs for:
 * - All finalized blocks
 * - All non-finalized checkpoint blocks
 *
 * Params:
 * - How many epochs ago do you consider a re-org can happen? 10
 * - How many consecutive slots in a epoch you consider can be skipped? 32
 *
 * ### What data to store?
 *
 * An altair beacon state has 24 fields, with a depth of 5.
 * | field                 | gindex | index |
 * | --------------------- | ------ | ----- |
 * | finalizedCheckpoint   | 52     | 20    |
 * | currentSyncCommittee  | 54     | 22    |
 * | nextSyncCommittee     | 55     | 23    |
 *
 * Fields `currentSyncCommittee` and `nextSyncCommittee` are contiguous fields. Since they change its
 * more optimal to only store the witnesses different blocks of interest.
 *
 * ```ts
 * SyncCommitteeWitness = Container({
 *   witness: Vector[Bytes32, 4],
 *   currentSyncCommitteeRoot: Bytes32,
 *   nextSyncCommitteeRoot: Bytes32,
 * })
 * ```
 *
 * To produce finalized light-client updates, need the FinalizedCheckpointWitness + the finalized header the checkpoint
 * points too. It's cheaper to send a full BeaconBlockHeader `3*32 + 2*8` than a proof to `state_root` `(3+1)*32`.
 *
 * ```ts
 * FinalizedCheckpointWitness = Container({
 *   witness: Vector[Bytes32, 5],
 *   root: Bytes32,
 *   epoch: Epoch,
 * })
 * ```
 *
 * ### When to store data?
 *
 * Lightclient servers don't really need to support serving data for light-client at all possible roots to have a
 * functional use-case.
 * - For init proofs light-clients will probably use a finalized weak-subjectivity checkpoint
 * - For sync updates, light-clients need any update within a given period
 *
 * Fully tree-backed states are not guaranteed to be available at any time but just after processing a block. Then,
 * the server must pre-compute all data for all blocks until there's certainity of what block becomes a checkpoint
 * and which blocks doesn't.
 *
 * - SyncAggregate -> ParentBlock -> FinalizedCheckpoint -> nextSyncCommittee
 *
 * After importing a new block + postState:
 * - Persist SyncCommitteeWitness, indexed by block root of state's witness, always
 * - Persist currentSyncCommittee, indexed by hashTreeRoot, once (not necessary after the first run)
 * - Persist nextSyncCommittee, indexed by hashTreeRoot, for each period + dependantRoot
 * - Persist FinalizedCheckpointWitness only if checkpoint period = syncAggregate period
 *
 * TODO: Prune strategy:
 * - [Low value] On finalized or in finalized lookup, prune SyncCommittee that's not finalized
 * - [High value] After some time prune un-used FinalizedCheckpointWitness + finalized headers
 * - [High value] After some time prune to-be-checkpoint items that will never become checkpoints
 * - After sync period is over all pending headers are useless
 *
 * !!! BEST = finalized + highest bit count + oldest (less chance of re-org, less writes)
 *
 * Then when light-client requests the best finalized update at period N:
 * - Fetch best finalized SyncAggregateHeader in period N
 * - Fetch FinalizedCheckpointWitness at that header's block root
 * - Fetch SyncCommitteeWitness at that FinalizedCheckpointWitness.header.root
 * - Fetch SyncCommittee at that SyncCommitteeWitness.nextSyncCommitteeRoot
 *
 * When light-client request best non-finalized update at period N:
 * - Fetch best non-finalized SyncAggregateHeader in period N
 * - Fetch SyncCommitteeWitness at that SyncAggregateHeader.header.root
 * - Fetch SyncCommittee at that SyncCommitteeWitness.nextSyncCommitteeRoot
 *
 * ```
 *                       Finalized               Block   Sync
 *                       Checkpoint              Header  Aggreate
 * ----------------------|-----------------------|-------|---------> time
 *                        <---------------------   <----
 *                         finalizes               signs
 * ```
 *
 * ### What's the cost of this data?
 *
 * To estimate the data costs, let's analyze monthly. Yearly may not make sense due to weak subjectivity:
 * - 219145 slots / month
 * - 6848 epochs / month
 * - 27 sync periods / month
 *
 * The byte size of a SyncCommittee (mainnet preset) is fixed to `48 * (512 + 1) = 24624`. So with SyncCommittee only
 * the data cost to store them is `24624 * 27 = 664848` ~ 0.6 MB/m.
 *
 * Storing 4 witness per block costs `219145 * 4 * 32 = 28050560 ~ 28 MB/m`.
 * Storing 4 witness per epoch costs `6848 * 4 * 32 = 876544 ~ 0.9 MB/m`.
 */
export class LightClientServer {
  private readonly db: IBeaconDb;
  private readonly config: IChainForkConfig;
  private readonly metrics: IMetrics | null;
  private readonly emitter: ChainEventEmitter;
  private readonly logger: ILogger;
  private readonly knownSyncCommittee = new MapDef<SyncPeriod, Set<DependantRootHex>>(() => new Set());
  private storedCurrentSyncCommittee = false;

  /**
   * Keep in memory since this data is very transient, not useful after a few slots
   */
  private readonly prevHeadData = new Map<BlockRooHex, SyncAttestedData>();
  private checkpointHeaders = new Map<BlockRooHex, phase0.BeaconBlockHeader>();
  private latestHeadUpdate: routes.lightclient.LightclientHeaderUpdate | null = null;

  private readonly zero: Pick<altair.LightClientUpdate, "finalityBranch" | "finalizedHeader">;
  private finalized?: Pick<
    altair.LightClientUpdate,
    "finalityBranch" | "finalizedHeader" | "attestedHeader" | "syncAggregate"
  >;

  constructor(modules: LightClientServerModules) {
    const {config, db, metrics, emitter, logger} = modules;
    this.config = config;
    this.db = db;
    this.metrics = metrics;
    this.emitter = emitter;
    this.logger = logger;

    this.zero = {
      finalizedHeader: ssz.phase0.BeaconBlockHeader.defaultValue(),
      finalityBranch: ssz.altair.LightClientUpdate.fields["finalityBranch"].defaultValue(),
    };
  }

  /**
   * Call after importing a block, having the postState available in memory for proof generation.
   * - Persist state witness
   * - Use block's syncAggregate
   */
  onImportBlock(
    block: altair.BeaconBlock,
    postState: CachedBeaconStateAltair,
    parentBlock: {blockRoot: RootHex; slot: Slot}
  ): void {
    // What is the syncAggregate signing?
    // From the beacon-state-transition
    // ```
    // const previousSlot = Math.max(block.slot, 1) - 1;
    // const rootSigned = getBlockRootAtSlot(state, previousSlot);
    // ```
    // In skipped slots the next value of blockRoots is set to the last block root.
    // So rootSigned will always equal to the parentBlock.
    const signedBlockRoot = block.parentRoot;

    this.onSyncAggregate(block.body.syncAggregate, signedBlockRoot).catch((e) => {
      this.logger.error("Error onSyncAggregate", {}, e);
    });

    this.persistPostBlockImportData(block, postState, parentBlock).catch((e) => {
      this.logger.error("Error persistPostBlockImportData", {}, e);
    });
  }

  /**
   * API ROUTE to get `currentSyncCommittee` and `nextSyncCommittee` from a trusted state root
   */
  async getSnapshot(blockRoot: Uint8Array): Promise<routes.lightclient.LightclientSnapshotWithProof> {
    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(blockRoot);
    if (!syncCommitteeWitness) {
      throw Error(`syncCommitteeWitness not available ${toHexString(blockRoot)}`);
    }

    const [currentSyncCommittee, nextSyncCommittee] = await Promise.all([
      this.db.syncCommittee.get(syncCommitteeWitness.currentSyncCommitteeRoot),
      this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot),
    ]);
    if (!currentSyncCommittee) {
      throw Error("currentSyncCommittee not available");
    }
    if (!nextSyncCommittee) {
      throw Error("nextSyncCommittee not available");
    }

    const header = await this.db.checkpointHeader.get(blockRoot);
    if (!header) {
      throw Error("header not available");
    }

    return {
      header,
      currentSyncCommittee,
      currentSyncCommitteeBranch: getCurrentSyncCommitteeBranch(syncCommitteeWitness),
    };
  }

  /**
   * API ROUTE to get the best available update for `period` to transition to the next sync committee.
   * Criteria for best in priority order:
   * - Is finalized
   * - Has the most bits
   * - Signed header at the oldest slot
   */
  async getCommitteeUpdates(period: SyncPeriod): Promise<altair.LightClientUpdate> {
    // Signature data
    const partialUpdate = await this.db.bestPartialLightClientUpdate.get(period);
    if (!partialUpdate) {
      throw Error(`No partialUpdate available for period ${period}`);
    }

    const syncCommitteeWitnessBlockRoot = partialUpdate.isFinalized
      ? (partialUpdate.finalizedCheckpoint.root as Uint8Array)
      : partialUpdate.blockRoot;

    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(syncCommitteeWitnessBlockRoot);
    if (!syncCommitteeWitness) {
      throw Error(`finalizedBlockRoot not available ${toHexString(syncCommitteeWitnessBlockRoot)}`);
    }

    const nextSyncCommittee = await this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot);
    if (!nextSyncCommittee) {
      throw Error("nextSyncCommittee not available");
    }

    if (partialUpdate.isFinalized) {
      return {
        attestedHeader: partialUpdate.attestedHeader,
        nextSyncCommittee: nextSyncCommittee,
        nextSyncCommitteeBranch: getNextSyncCommitteeBranch(syncCommitteeWitness),
        finalizedHeader: partialUpdate.finalizedHeader,
        finalityBranch: partialUpdate.finalityBranch,
        syncAggregate: partialUpdate.syncAggregate,
        forkVersion: this.config.getForkVersion(partialUpdate.attestedHeader.slot),
      };
    } else {
      return {
        attestedHeader: partialUpdate.attestedHeader,
        nextSyncCommittee: nextSyncCommittee,
        nextSyncCommitteeBranch: getNextSyncCommitteeBranch(syncCommitteeWitness),
        finalizedHeader: this.zero.finalizedHeader,
        finalityBranch: this.zero.finalityBranch,
        syncAggregate: partialUpdate.syncAggregate,
        forkVersion: this.config.getForkVersion(partialUpdate.attestedHeader.slot),
      };
    }
  }

  /**
   * API ROUTE to poll LightclientHeaderUpdate.
   * Clients should use the SSE type `lightclient_header_update` if available
   */
  async getLatestHeadUpdate(): Promise<routes.lightclient.LightclientHeaderUpdate> {
    if (this.latestHeadUpdate === null) {
      throw Error("No latest header update available");
    }
    return this.latestHeadUpdate;
  }

  async getFinalizedHeadUpdate(): Promise<routes.lightclient.LightclientFinalizedUpdate> {
    // Signature data
    if (this.finalized == null) {
      throw Error("No latest header update available");
    }
    return this.finalized;
  }

  /**
   * With forkchoice data compute which block roots will never become checkpoints and prune them.
   */
  async pruneNonCheckpointData(nonCheckpointBlockRoots: Uint8Array[]): Promise<void> {
    // TODO: Batch delete with native leveldb batching not just Promise.all()
    await Promise.all([
      this.db.syncCommitteeWitness.batchDelete(nonCheckpointBlockRoots),
      this.db.checkpointHeader.batchDelete(nonCheckpointBlockRoots),
    ]);
  }

  private async persistPostBlockImportData(
    block: altair.BeaconBlock,
    postState: CachedBeaconStateAltair,
    parentBlock: {blockRoot: RootHex; slot: Slot}
  ): Promise<void> {
    const blockSlot = block.slot;

    const header: phase0.BeaconBlockHeader = {
      slot: blockSlot,
      proposerIndex: block.proposerIndex,
      parentRoot: block.parentRoot,
      stateRoot: block.stateRoot,
      bodyRoot: this.config.getForkTypes(blockSlot).BeaconBlockBody.hashTreeRoot(block.body),
    };

    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    const blockRootHex = toHexString(blockRoot);

    const syncCommitteeWitness = getSyncCommitteesWitness(postState);

    // Only store current sync committee once per run
    if (!this.storedCurrentSyncCommittee) {
      await Promise.all([
        this.storeSyncCommittee(postState.currentSyncCommittee, syncCommitteeWitness.currentSyncCommitteeRoot),
        this.storeSyncCommittee(postState.nextSyncCommittee, syncCommitteeWitness.nextSyncCommitteeRoot),
      ]);
      this.storedCurrentSyncCommittee = true;
      this.logger.debug("Stored currentSyncCommittee", {slot: blockSlot});
    }

    // Only store next sync committee once per dependant root
    const parentBlockPeriod = computeSyncPeriodAtSlot(parentBlock.slot);
    const period = computeSyncPeriodAtSlot(blockSlot);
    if (parentBlockPeriod < period) {
      // If the parentBlock is in a previous epoch it must be the dependantRoot of this epoch transition
      const dependantRoot = parentBlock.blockRoot;
      const periodDependantRoots = this.knownSyncCommittee.getOrDefault(period);
      if (!periodDependantRoots.has(dependantRoot)) {
        periodDependantRoots.add(dependantRoot);
        await this.storeSyncCommittee(postState.nextSyncCommittee, syncCommitteeWitness.nextSyncCommitteeRoot);
        this.logger.debug("Stored nextSyncCommittee", {period, slot: blockSlot, dependantRoot});
      }
    }

    // Ensure referenced syncCommittee are persisted before persiting this one
    await this.db.syncCommitteeWitness.put(blockRoot, syncCommitteeWitness);

    // Store header in case it is referenced latter by a future finalized checkpoint
    await this.db.checkpointHeader.put(blockRoot, header);

    // Store finalized checkpoint data
    const finalizedCheckpoint = postState.finalizedCheckpoint;
    const finalizedCheckpointPeriod = computeSyncPeriodAtEpoch(finalizedCheckpoint.epoch);
    const isFinalized =
      finalizedCheckpointPeriod === period &&
      // Consider the edge case of genesis: Genesis state's finalizedCheckpoint is zero'ed.
      // If finalizedCheckpoint is zeroed, consider not finalized (ignore) since there won't exist a
      // finalized header for that root
      finalizedCheckpoint.epoch !== 0 &&
      !byteArrayEquals(finalizedCheckpoint.root, ZERO_HASH);

    this.prevHeadData.set(
      blockRootHex,
      isFinalized
        ? {
            isFinalized: true,
            attestedHeader: header,
            blockRoot,
            finalityBranch: getFinalizedRootProof(postState),
            finalizedCheckpoint,
          }
        : {
            isFinalized: false,
            attestedHeader: header,
            blockRoot,
          }
    );

    pruneSetToMax(this.prevHeadData, MAX_PREV_HEAD_DATA);
  }

  /**
   * 1. Subscribe to gossip topics `sync_committee_{subnet_id}` and collect `sync_committee_message`
   * ```
   * slot: Slot
   * beacon_block_root: Root
   * validator_index: ValidatorIndex
   * signature: BLSSignature
   * ```
   *
   * 2. Subscribe to `sync_committee_contribution_and_proof` and collect `signed_contribution_and_proof`
   * ```
   * slot: Slot
   * beacon_block_root: Root
   * subcommittee_index: uint64
   * aggregation_bits: Bitvector[SYNC_COMMITTEE_SIZE // SYNC_COMMITTEE_SUBNET_COUNT]
   * signature: BLSSignature
   * ```
   *
   * 3. On new blocks use `block.body.sync_aggregate`, `block.parent_root` and `block.slot - 1`
   */
  private async onSyncAggregate(syncAggregate: altair.SyncAggregate, signedBlockRoot: Root): Promise<void> {
    const signedBlockRootHex = toHexString(signedBlockRoot);
    const attestedData = this.prevHeadData.get(signedBlockRootHex);
    if (!attestedData) {
      // Check for .size > 0 to prevent erroring always in the first run
      if (this.prevHeadData.size === 0) {
        return;
      } else {
        throw Error("attestedData not available");
      }
    }

    const headerUpdate: routes.lightclient.LightclientHeaderUpdate = {
      attestedHeader: attestedData.attestedHeader,
      syncAggregate,
    };

    // Emit update
    // - At the earliest: 6 second after the slot start
    // - After a new update has INCREMENT_THRESHOLD == 32 bits more than the previous emitted threshold
    this.emitter.emit(ChainEvent.lightclientHeaderUpdate, headerUpdate);

    // Persist latest best update for getHeadUpdate()
    // TODO: Once SyncAggregate are constructed from P2P too, count bits to decide "best"
    if (!this.latestHeadUpdate || attestedData.attestedHeader.slot > this.latestHeadUpdate.attestedHeader.slot) {
      this.latestHeadUpdate = headerUpdate;
    }

    if (attestedData.isFinalized) {
      const finalizedCheckpointRoot = attestedData.finalizedCheckpoint.root as Uint8Array;
      const finalizedHeader = await this.getFinalizedHeader(finalizedCheckpointRoot);
      if (
        finalizedHeader &&
        (!this.finalized ||
          finalizedHeader.slot > this.finalized.finalizedHeader.slot ||
          sumBits(syncAggregate.syncCommitteeBits) > sumBits(this.finalized.syncAggregate.syncCommitteeBits))
      ) {
        this.finalized = {
          attestedHeader: attestedData.attestedHeader,
          finalizedHeader,
          syncAggregate,
          finalityBranch: attestedData.finalityBranch,
        };
        this.emitter.emit(ChainEvent.lightclientFinalizedUpdate, this.finalized);
      }
    }

    // Check if this update is better, otherwise ignore
    await this.maybeStoreNewBestPartialUpdate(syncAggregate, attestedData);
  }

  /**
   * Given a new `syncAggregate` maybe persist a new best partial update if its better than the current stored for
   * that sync period.
   */
  private async maybeStoreNewBestPartialUpdate(
    syncAggregate: altair.SyncAggregate,
    attestedData: SyncAttestedData
  ): Promise<void> {
    const period = computeSyncPeriodAtSlot(attestedData.attestedHeader.slot);
    const prevBestUpdate = await this.db.bestPartialLightClientUpdate.get(period);
    if (prevBestUpdate && !isBetterUpdate(prevBestUpdate, syncAggregate, attestedData)) {
      // TODO: Do metrics on how often updates are overwritten
      return;
    }

    let newPartialUpdate: PartialLightClientUpdate;

    if (attestedData.isFinalized) {
      // If update if finalized retrieve the previously stored header from DB.
      // Only checkpoint candidates are stored, and not all headers are guaranteed to be available
      const finalizedCheckpointRoot = attestedData.finalizedCheckpoint.root as Uint8Array;
      const finalizedHeader = await this.getFinalizedHeader(finalizedCheckpointRoot);
      if (finalizedHeader) {
        // If finalizedHeader is available (should be most times) create a finalized update
        newPartialUpdate = {...attestedData, finalizedHeader, syncAggregate};
      } else {
        // If finalizedHeader is not available (happens on startup) create a non-finalized update
        newPartialUpdate = {...attestedData, isFinalized: false, syncAggregate};
      }
    } else {
      newPartialUpdate = {...attestedData, syncAggregate};
    }

    await this.db.bestPartialLightClientUpdate.put(period, newPartialUpdate);
    this.logger.debug("Stored new PartialLightClientUpdate", {
      period,
      isFinalized: attestedData.isFinalized,
      participation: sumBits(syncAggregate.syncCommitteeBits) / SYNC_COMMITTEE_SIZE,
    });

    // Count total persisted updates per type. DB metrics don't diff between each type.
    // The frequency of finalized vs non-finalized is critical to debug if finalizedHeader is not available
    this.metrics?.lightclientServer.persistedUpdates.inc({
      type: newPartialUpdate.isFinalized ? "finalized" : "non-finalized",
    });
  }

  private async storeSyncCommittee(
    syncCommittee: CompositeViewDU<typeof ssz.altair.SyncCommittee>,
    syncCommitteeRoot: Uint8Array
  ): Promise<void> {
    const isKnown = await this.db.syncCommittee.has(syncCommitteeRoot);
    if (!isKnown) {
      await this.db.syncCommittee.putBinary(syncCommitteeRoot, syncCommittee.serialize());
    }
  }

  /**
   * Get finalized header from db. Keeps a small in-memory cache to speed up most of the lookups
   */
  private async getFinalizedHeader(finalizedBlockRoot: Uint8Array): Promise<phase0.BeaconBlockHeader | null> {
    const finalizedBlockRootHex = toHexString(finalizedBlockRoot);
    const cachedFinalizedHeader = this.checkpointHeaders.get(finalizedBlockRootHex);
    if (cachedFinalizedHeader) {
      return cachedFinalizedHeader;
    }

    const finalizedHeader = await this.db.checkpointHeader.get(finalizedBlockRoot);
    if (!finalizedHeader) {
      // finalityHeader is not available during sync, since started after the finalized checkpoint.
      // See https://github.com/ChainSafe/lodestar/issues/3495
      // To prevent excesive logging this condition is not considered an error, but the lightclient updater
      // will just create a non-finalized update.
      this.logger.debug("finalizedHeader not available", {root: finalizedBlockRootHex});
      return null;
    }

    this.checkpointHeaders.set(finalizedBlockRootHex, finalizedHeader);
    pruneSetToMax(this.checkpointHeaders, MAX_CACHED_FINALIZED_HEADERS);

    return finalizedHeader;
  }
}

/**
 * Returns the update with more bits. On ties, prevUpdate is the better
 *
 * Spec v1.0.1
 * ```python
 * max(store.valid_updates, key=lambda update: sum(update.sync_committee_bits)))
 * ```
 */
export function isBetterUpdate(
  prevUpdate: PartialLightClientUpdate,
  nextSyncAggregate: altair.SyncAggregate,
  nextSyncAttestedData: SyncAttestedData
): boolean {
  const nextBitCount = sumBits(nextSyncAggregate.syncCommitteeBits);

  // Finalized if participation is over 66%
  if (!prevUpdate.isFinalized && nextSyncAttestedData.isFinalized && nextBitCount * 3 > SYNC_COMMITTEE_SIZE * 2) {
    return true;
  }

  // Higher bit count
  const prevBitCount = sumBits(prevUpdate.syncAggregate.syncCommitteeBits);
  if (prevBitCount > nextBitCount) return false;
  if (prevBitCount < nextBitCount) return true;

  // else keep the oldest, lowest chance or re-org and requires less updating
  return prevUpdate.attestedHeader.slot > nextSyncAttestedData.attestedHeader.slot;
}

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}
