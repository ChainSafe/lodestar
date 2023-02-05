import {altair, phase0, Root, RootHex, Slot, ssz, SyncPeriod, allForks} from "@lodestar/types";
import {IChainForkConfig} from "@lodestar/config";
import {
  CachedBeaconStateAltair,
  computeStartSlotAtEpoch,
  computeSyncPeriodAtEpoch,
  computeSyncPeriodAtSlot,
  executionPayloadToPayloadHeader,
} from "@lodestar/state-transition";
import {isBetterUpdate, toLightClientUpdateSummary, LightClientUpdateSummary} from "@lodestar/light-client/spec";
import {ILogger, MapDef, pruneSetToMax} from "@lodestar/utils";
import {routes} from "@lodestar/api";
import {BitArray, CompositeViewDU, toHexString} from "@chainsafe/ssz";
import {MIN_SYNC_COMMITTEE_PARTICIPANTS, SYNC_COMMITTEE_SIZE, ForkName, ForkSeq, ForkExecution} from "@lodestar/params";

import {IBeaconDb} from "../../db/index.js";
import {IMetrics} from "../../metrics/index.js";
import {ChainEventEmitter} from "../emitter.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {ZERO_HASH} from "../../constants/index.js";
import {LightClientServerError, LightClientServerErrorCode} from "../errors/lightClientError.js";
import {
  getNextSyncCommitteeBranch,
  getSyncCommitteesWitness,
  getFinalizedRootProof,
  getCurrentSyncCommitteeBranch,
  getBlockBodyExecutionHeaderProof,
} from "./proofs.js";

export type LightClientServerOpts = {
  disableLightClientServerOnImportBlockHead?: boolean;
};

type DependantRootHex = RootHex;
type BlockRooHex = RootHex;

export type SyncAttestedData = {
  attestedHeader: allForks.LightClientHeader;
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
  private checkpointHeaders = new Map<BlockRooHex, allForks.LightClientHeader>();
  private latestHeadUpdate: altair.LightClientOptimisticUpdate | null = null;

  private readonly zero: Pick<altair.LightClientUpdate, "finalityBranch" | "finalizedHeader">;
  private finalized: allForks.LightClientFinalityUpdate | null = null;

  constructor(private readonly opts: LightClientServerOpts, modules: LightClientServerModules) {
    const {config, db, metrics, emitter, logger} = modules;
    this.config = config;
    this.db = db;
    this.metrics = metrics;
    this.emitter = emitter;
    this.logger = logger;

    this.zero = {
      finalizedHeader: ssz.altair.LightClientHeader.defaultValue(),
      finalityBranch: ssz.altair.LightClientUpdate.fields["finalityBranch"].defaultValue(),
    };

    if (metrics) {
      metrics.lightclientServer.highestSlot.addCollect(() => {
        if (this.latestHeadUpdate) {
          metrics.lightclientServer.highestSlot.set(
            {item: "latest_head_update"},
            this.latestHeadUpdate.attestedHeader.beacon.slot
          );
        }
        if (this.finalized) {
          metrics.lightclientServer.highestSlot.set(
            {item: "latest_finalized_update"},
            this.finalized.attestedHeader.beacon.slot
          );
        }
      });
    }
  }

  /**
   * Call after importing a block head, having the postState available in memory for proof generation.
   * - Persist state witness
   * - Use block's syncAggregate
   */
  onImportBlockHead(
    block: allForks.AllForksLightClient["BeaconBlock"],
    postState: CachedBeaconStateAltair,
    parentBlockSlot: Slot
  ): void {
    // TEMP: To disable this functionality for fork_choice spec tests.
    // Since the tests have deep-reorgs attested data is not available often printing lots of error logs.
    // While this function is only called for head blocks, best to disable.
    if (this.opts.disableLightClientServerOnImportBlockHead) {
      return;
    }

    // What is the syncAggregate signing?
    // From the state-transition
    // ```
    // const previousSlot = Math.max(block.slot, 1) - 1;
    // const rootSigned = getBlockRootAtSlot(state, previousSlot);
    // ```
    // In skipped slots the next value of blockRoots is set to the last block root.
    // So rootSigned will always equal to the parentBlock.
    const signedBlockRoot = block.parentRoot;
    const syncPeriod = computeSyncPeriodAtSlot(block.slot);

    this.onSyncAggregate(syncPeriod, block.body.syncAggregate, block.slot, signedBlockRoot).catch((e) => {
      this.logger.error("Error onSyncAggregate", {}, e);
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "error"});
    });

    this.persistPostBlockImportData(block, postState, parentBlockSlot).catch((e) => {
      this.logger.error("Error persistPostBlockImportData", {}, e);
    });
  }

  /**
   * API ROUTE to get `currentSyncCommittee` and `nextSyncCommittee` from a trusted state root
   */
  async getBootstrap(blockRoot: Uint8Array): Promise<altair.LightClientBootstrap> {
    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(blockRoot);
    if (!syncCommitteeWitness) {
      throw new LightClientServerError(
        {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
        `syncCommitteeWitness not available ${toHexString(blockRoot)}`
      );
    }

    const [currentSyncCommittee, nextSyncCommittee] = await Promise.all([
      this.db.syncCommittee.get(syncCommitteeWitness.currentSyncCommitteeRoot),
      this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot),
    ]);
    if (!currentSyncCommittee) {
      throw new LightClientServerError(
        {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
        "currentSyncCommittee not available"
      );
    }
    if (!nextSyncCommittee) {
      throw new LightClientServerError(
        {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
        "nextSyncCommittee not available"
      );
    }

    const header = await this.db.checkpointHeader.get(blockRoot);
    if (!header) {
      throw new LightClientServerError({code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE}, "header not available");
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
  async getUpdate(period: number): Promise<altair.LightClientUpdate> {
    // Signature data
    const update = await this.db.bestLightClientUpdate.get(period);
    if (!update) {
      throw Error(`No partialUpdate available for period ${period}`);
    }
    return update;
  }

  /**
   * API ROUTE to get the sync committee hash from the best available update for `period`.
   */
  async getCommitteeRoot(period: number): Promise<Uint8Array> {
    const {attestedHeader} = await this.getUpdate(period);
    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(attestedHeader.beacon);

    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(blockRoot);
    if (!syncCommitteeWitness) {
      throw new LightClientServerError(
        {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
        `syncCommitteeWitness not available ${toHexString(blockRoot)} period ${period}`
      );
    }

    return syncCommitteeWitness.currentSyncCommitteeRoot;
  }

  /**
   * API ROUTE to poll LightclientHeaderUpdate.
   * Clients should use the SSE type `light_client_optimistic_update` if available
   */
  getOptimisticUpdate(): altair.LightClientOptimisticUpdate | null {
    return this.latestHeadUpdate;
  }

  getFinalityUpdate(): altair.LightClientFinalityUpdate | null {
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
    block: allForks.AllForksLightClient["BeaconBlock"],
    postState: CachedBeaconStateAltair,
    parentBlockSlot: Slot
  ): Promise<void> {
    const blockSlot = block.slot;
    const header = blockToLightClientHeader(this.config.getForkName(blockSlot), block);

    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header.beacon);
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
    const parentBlockPeriod = computeSyncPeriodAtSlot(parentBlockSlot);
    const period = computeSyncPeriodAtSlot(blockSlot);
    if (parentBlockPeriod < period) {
      // If the parentBlock is in a previous epoch it must be the dependantRoot of this epoch transition
      const dependantRoot = toHexString(block.parentRoot);
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
   *
   * @param syncPeriod The sync period of the sync aggregate and signed block root
   */
  private async onSyncAggregate(
    syncPeriod: SyncPeriod,
    syncAggregate: altair.SyncAggregate,
    signatureSlot: Slot,
    signedBlockRoot: Root
  ): Promise<void> {
    this.metrics?.lightclientServer.onSyncAggregate.inc({event: "processed"});

    const signedBlockRootHex = toHexString(signedBlockRoot);
    const attestedData = this.prevHeadData.get(signedBlockRootHex);
    if (!attestedData) {
      // Log cacheSize since at start this.prevHeadData will be empty
      this.logger.debug("attestedData not available", {root: signedBlockRootHex, cacheSize: this.prevHeadData.size});
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_no_attested_data"});
      return;
    }

    const {attestedHeader, isFinalized} = attestedData;
    const attestedPeriod = computeSyncPeriodAtSlot(attestedHeader.beacon.slot);
    if (syncPeriod !== attestedPeriod) {
      this.logger.debug("attested data period different than signature period", {syncPeriod, attestedPeriod});
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_attested_period_diff"});
      return;
    }

    const headerUpdate: altair.LightClientOptimisticUpdate = {
      attestedHeader,
      syncAggregate,
      signatureSlot,
    };

    const syncAggregateParticipation = sumBits(syncAggregate.syncCommitteeBits);

    if (syncAggregateParticipation < MIN_SYNC_COMMITTEE_PARTICIPANTS) {
      this.logger.debug("sync committee below required MIN_SYNC_COMMITTEE_PARTICIPANTS", {
        syncPeriod,
        attestedPeriod,
      });
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_sync_committee_low"});
      return;
    }

    // Emit update
    // Note: Always emit optimistic update even if we have emitted one with higher or equal attested_header.slot
    this.emitter.emit(routes.events.EventType.lightClientOptimisticUpdate, headerUpdate);

    // Persist latest best update for getLatestHeadUpdate()
    // TODO: Once SyncAggregate are constructed from P2P too, count bits to decide "best"
    if (!this.latestHeadUpdate || attestedHeader.beacon.slot > this.latestHeadUpdate.attestedHeader.beacon.slot) {
      this.latestHeadUpdate = headerUpdate;
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "update_latest_head_update"});
    }

    if (isFinalized) {
      const finalizedCheckpointRoot = attestedData.finalizedCheckpoint.root as Uint8Array;
      const finalizedHeader = await this.getFinalizedHeader(finalizedCheckpointRoot);

      if (
        finalizedHeader &&
        (!this.finalized ||
          finalizedHeader.beacon.slot > this.finalized.finalizedHeader.beacon.slot ||
          syncAggregateParticipation > sumBits(this.finalized.syncAggregate.syncCommitteeBits))
      ) {
        this.finalized = {
          attestedHeader,
          finalizedHeader,
          syncAggregate,
          finalityBranch: attestedData.finalityBranch,
          signatureSlot,
        };
        this.metrics?.lightclientServer.onSyncAggregate.inc({event: "update_latest_finalized_update"});

        // Note: Ignores gossip rule to always emit finaly_update with higher finalized_header.slot, for simplicity
        this.emitter.emit(routes.events.EventType.lightClientFinalityUpdate, this.finalized);
      }
    }

    // Check if this update is better, otherwise ignore
    try {
      await this.maybeStoreNewBestUpdate(syncPeriod, syncAggregate, signatureSlot, attestedData);
    } catch (e) {
      this.logger.error(
        "Error updating best LightClientUpdate",
        {syncPeriod, slot: attestedHeader.beacon.slot, blockRoot: toHexString(attestedData.blockRoot)},
        e as Error
      );
    }
  }

  /**
   * Given a new `syncAggregate` maybe persist a new best partial update if its better than the current stored for
   * that sync period.
   */
  private async maybeStoreNewBestUpdate(
    syncPeriod: SyncPeriod,
    syncAggregate: altair.SyncAggregate,
    signatureSlot: Slot,
    attestedData: SyncAttestedData
  ): Promise<void> {
    const prevBestUpdate = await this.db.bestLightClientUpdate.get(syncPeriod);
    const {attestedHeader} = attestedData;

    if (prevBestUpdate) {
      const prevBestUpdateSummary = toLightClientUpdateSummary(prevBestUpdate);

      const nextBestUpdate: LightClientUpdateSummary = {
        activeParticipants: sumBits(syncAggregate.syncCommitteeBits),
        attestedHeaderSlot: attestedHeader.beacon.slot,
        signatureSlot,
        // The actual finalizedHeader is fetched below. To prevent a DB read we approximate the actual slot.
        // If update is not finalized finalizedHeaderSlot does not matter (see is_better_update), so setting
        // to zero to set it some number.
        finalizedHeaderSlot: attestedData.isFinalized
          ? computeStartSlotAtEpoch(attestedData.finalizedCheckpoint.epoch)
          : 0,
        // All updates include a valid `nextSyncCommitteeBranch`, see below code
        isSyncCommitteeUpdate: true,
        isFinalityUpdate: attestedData.isFinalized,
      };

      if (!isBetterUpdate(nextBestUpdate, prevBestUpdateSummary)) {
        this.metrics?.lightclientServer.updateNotBetter.inc();
        return;
      }
    }

    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(attestedData.blockRoot);
    if (!syncCommitteeWitness) {
      throw Error(`syncCommitteeWitness not available at ${toHexString(attestedData.blockRoot)}`);
    }
    const nextSyncCommittee = await this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot);
    if (!nextSyncCommittee) {
      throw Error("nextSyncCommittee not available");
    }
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteeWitness);
    const finalizedHeader = attestedData.isFinalized
      ? await this.getFinalizedHeader(attestedData.finalizedCheckpoint.root as Uint8Array)
      : null;

    let newUpdate: altair.LightClientUpdate;
    let isFinalized;
    if (
      attestedData.isFinalized &&
      finalizedHeader &&
      computeSyncPeriodAtSlot(finalizedHeader.beacon.slot) == syncPeriod
    ) {
      isFinalized = true;
      newUpdate = {
        attestedHeader,
        nextSyncCommittee: nextSyncCommittee,
        nextSyncCommitteeBranch,
        finalizedHeader,
        finalityBranch: attestedData.finalityBranch,
        syncAggregate,
        signatureSlot,
      };
    } else {
      isFinalized = false;
      newUpdate = {
        attestedHeader,
        nextSyncCommittee: nextSyncCommittee,
        nextSyncCommitteeBranch,
        finalizedHeader: this.zero.finalizedHeader,
        finalityBranch: this.zero.finalityBranch,
        syncAggregate,
        signatureSlot,
      };
    }

    // attestedData and the block of syncAggregate may not be in same sync period
    // should not use attested data slot as sync period
    // see https://github.com/ChainSafe/lodestar/issues/3933
    await this.db.bestLightClientUpdate.put(syncPeriod, newUpdate);
    this.logger.debug("Stored new PartialLightClientUpdate", {
      syncPeriod,
      isFinalized,
      participation: sumBits(syncAggregate.syncCommitteeBits) / SYNC_COMMITTEE_SIZE,
    });

    // Count total persisted updates per type. DB metrics don't diff between each type.
    // The frequency of finalized vs non-finalized is critical to debug if finalizedHeader is not available
    this.metrics?.lightclientServer.onSyncAggregate.inc({
      event: isFinalized ? "store_finalized_update" : "store_nonfinalized_update",
    });
    this.metrics?.lightclientServer.highestSlot.set(
      {item: isFinalized ? "best_finalized_update" : "best_nonfinalized_update"},
      newUpdate.attestedHeader.beacon.slot
    );
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
  private async getFinalizedHeader(finalizedBlockRoot: Uint8Array): Promise<allForks.LightClientHeader | null> {
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

export function sumBits(bits: BitArray): number {
  return bits.getTrueBitIndexes().length;
}

export function blockToLightClientHeader(
  fork: ForkName,
  block: allForks.AllForksLightClient["BeaconBlock"]
): allForks.LightClientHeader {
  const blockSlot = block.slot;
  const beacon: phase0.BeaconBlockHeader = {
    slot: blockSlot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: block.stateRoot,
    bodyRoot: (ssz[fork].BeaconBlockBody as allForks.AllForksLightClientSSZTypes["BeaconBlockBody"]).hashTreeRoot(
      block.body
    ),
  };
  if (ForkSeq[fork] >= ForkSeq.capella) {
    const blockBody = block.body as allForks.AllForksExecution["BeaconBlockBody"];
    const execution = executionPayloadToPayloadHeader(ForkSeq[fork], blockBody.executionPayload);
    return {
      beacon,
      execution,
      executionBranch: getBlockBodyExecutionHeaderProof(fork as ForkExecution, blockBody),
    } as allForks.LightClientHeader;
  } else {
    return {beacon};
  }
}
