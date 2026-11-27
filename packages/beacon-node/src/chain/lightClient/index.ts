import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostGloas,
  ForkPreGloas,
  ForkSeq,
  GENESIS_EPOCH,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {
  type IBeaconStateViewAltair,
  computeSyncPeriodAtSlot,
  executionPayloadToPayloadHeader,
} from "@lodestar/state-transition";
import {
  LightClientUpdateSummary,
  isBetterUpdate,
  toLightClientUpdateSummary,
  upgradeLightClientHeader,
} from "@lodestar/state-transition/light-client";
import {
  BeaconBlock,
  BeaconBlockBody,
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientHeader,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  Root,
  RootHex,
  SSZTypesFor,
  Slot,
  SyncPeriod,
  altair,
  phase0,
  ssz,
} from "@lodestar/types";
import {Logger, MapDef, pruneSetToMax, toRootHex} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {NUM_WITNESS, NUM_WITNESS_ELECTRA} from "../../db/repositories/lightclientSyncCommitteeWitness.js";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {ChainEventEmitter} from "../emitter.js";
import {LightClientServerError, LightClientServerErrorCode} from "../errors/lightClientError.js";
import {
  getBlockBodyExecutionBlockHashProof,
  getBlockBodyExecutionHeaderProof,
  getCurrentSyncCommitteeBranch,
  getNextSyncCommitteeBranch,
} from "./proofs.js";

export type LightClientServerOpts = {
  disableLightClientServerOnImportBlockHead?: boolean;
  disableLightClientServer?: boolean;
};

type DependentRootHex = RootHex;
type BlockRooHex = RootHex;
type LightClientZeroFinality = Pick<LightClientUpdate, "finalityBranch" | "finalizedHeader">;

export type SyncAttestedData = {
  attestedHeader: LightClientHeader;
  /** Precomputed root to prevent re-hashing */
  blockRoot: Uint8Array;
  finalizedCheckpoint: phase0.Checkpoint;
  finalityBranch: Uint8Array[];
};

type LightClientServerModules = {
  config: ChainForkConfig;
  clock: IClock;
  db: IBeaconDb;
  metrics: Metrics | null;
  emitter: ChainEventEmitter;
  logger: Logger;
  signal: AbortSignal;
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
 * - Persist nextSyncCommittee, indexed by hashTreeRoot, for each period + dependentRoot
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
  private readonly config: ChainForkConfig;
  private readonly metrics: Metrics | null;
  private readonly emitter: ChainEventEmitter;
  private readonly logger: Logger;
  private readonly clock: IClock;
  private readonly signal: AbortSignal;
  private readonly knownSyncCommittee = new MapDef<SyncPeriod, Set<DependentRootHex>>(() => new Set());
  private readonly zeroFinalityByFork = new Map<ForkName, LightClientZeroFinality>();
  private storedCurrentSyncCommittee = false;

  /**
   * Keep in memory since this data is very transient, not useful after a few slots
   */
  private readonly prevHeadData = new Map<BlockRooHex, SyncAttestedData>();
  private checkpointHeaders = new Map<BlockRooHex, LightClientHeader>();
  private latestHeadUpdate: LightClientOptimisticUpdate | null = null;

  private finalized: LightClientFinalityUpdate | null = null;

  constructor(
    private readonly opts: LightClientServerOpts,
    modules: LightClientServerModules
  ) {
    const {config, clock, db, metrics, emitter, logger, signal} = modules;
    this.config = config;
    this.clock = clock;
    this.db = db;
    this.metrics = metrics;
    this.emitter = emitter;
    this.logger = logger;
    this.signal = signal;

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
    block: BeaconBlock<ForkPostAltair>,
    postState: IBeaconStateViewAltair,
    parentBlockSlot: Slot
  ): void {
    // TEMP: To disable this functionality for fork_choice spec tests.
    // Since the tests have deep-reorgs attested data is not available often printing lots of error logs.
    // While this function is only called for head blocks, best to disable.
    if (this.opts.disableLightClientServerOnImportBlockHead) {
      return;
    }

    // pq removes sync committees and with them the light client protocol
    if (!("syncAggregate" in block.body)) {
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
      if (!this.signal.aborted) {
        this.logger.error("Error onSyncAggregate", {}, e);
        this.metrics?.lightclientServer.onSyncAggregate.inc({event: "error"});
      }
    });

    this.persistPostBlockImportData(block, postState, parentBlockSlot).catch((e) => {
      if (!this.signal.aborted) {
        this.logger.error("Error persistPostBlockImportData", {}, e);
      }
    });
  }

  /**
   * API ROUTE to get `currentSyncCommittee` and `nextSyncCommittee` from a trusted state root
   */
  async getBootstrap(blockRoot: Uint8Array): Promise<LightClientBootstrap> {
    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(blockRoot);
    if (!syncCommitteeWitness) {
      throw new LightClientServerError(
        {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
        `syncCommitteeWitness not available ${toRootHex(blockRoot)}`
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
  async getUpdate(period: number): Promise<LightClientUpdate> {
    // Signature data
    const update = await this.db.bestLightClientUpdate.get(period);
    if (!update) {
      throw new LightClientServerError(
        {code: LightClientServerErrorCode.RESOURCE_UNAVAILABLE},
        `No partialUpdate available for period ${period}`
      );
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
        `syncCommitteeWitness not available ${toRootHex(blockRoot)} period ${period}`
      );
    }

    return syncCommitteeWitness.currentSyncCommitteeRoot;
  }

  /**
   * API ROUTE to poll LightclientHeaderUpdate.
   * Clients should use the SSE type `light_client_optimistic_update` if available
   */
  getOptimisticUpdate(): LightClientOptimisticUpdate | null {
    return this.latestHeadUpdate;
  }

  getFinalityUpdate(): LightClientFinalityUpdate | null {
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
    block: BeaconBlock<ForkPostAltair>,
    postState: IBeaconStateViewAltair,
    parentBlockSlot: Slot
  ): Promise<void> {
    const blockSlot = block.slot;
    const fork = this.config.getForkName(blockSlot);
    const header = blockToLightClientHeader(fork, block);

    const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header.beacon);
    const blockRootHex = toRootHex(blockRoot);

    const syncCommitteeWitness = postState.getSyncCommitteesWitness();

    // Only store current sync committee once per run
    if (!this.storedCurrentSyncCommittee) {
      await Promise.all([
        this.storeSyncCommittee(postState.currentSyncCommittee, syncCommitteeWitness.currentSyncCommitteeRoot),
        this.storeSyncCommittee(postState.nextSyncCommittee, syncCommitteeWitness.nextSyncCommitteeRoot),
      ]);
      this.storedCurrentSyncCommittee = true;
      this.logger.debug("Stored currentSyncCommittee", {slot: blockSlot});
    }

    // Only store next sync committee once per dependent root
    const parentBlockPeriod = computeSyncPeriodAtSlot(parentBlockSlot);
    const period = computeSyncPeriodAtSlot(blockSlot);
    if (parentBlockPeriod < period) {
      // If the parentBlock is in a previous epoch it must be the dependentRoot of this epoch transition
      const dependentRoot = toRootHex(block.parentRoot);
      const periodDependentRoots = this.knownSyncCommittee.getOrDefault(period);
      if (!periodDependentRoots.has(dependentRoot)) {
        periodDependentRoots.add(dependentRoot);
        await this.storeSyncCommittee(postState.nextSyncCommittee, syncCommitteeWitness.nextSyncCommitteeRoot);
        this.logger.debug("Stored nextSyncCommittee", {period, slot: blockSlot, dependentRoot});
      }
    }

    // Ensure referenced syncCommittee are persisted before persiting this one
    await this.db.syncCommitteeWitness.put(blockRoot, syncCommitteeWitness);

    // Store header in case it is referenced latter by a future finalized checkpoint
    await this.db.checkpointHeader.put(blockRoot, header);

    // Store finalized checkpoint data. The finality branch only depends on the post state, so it is
    // collected for every block; see `buildUpdate` for the cases in which it is served.
    this.prevHeadData.set(blockRootHex, {
      attestedHeader: header,
      blockRoot,
      finalizedCheckpoint: postState.finalizedCheckpoint,
      finalityBranch: postState.getFinalizedRootProof(),
    });

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

    const signedBlockRootHex = toRootHex(signedBlockRoot);
    const attestedData = this.prevHeadData.get(signedBlockRootHex);
    if (!attestedData) {
      // Log cacheSize since at start this.prevHeadData will be empty
      this.logger.debug("attestedData not available", {root: signedBlockRootHex, cacheSize: this.prevHeadData.size});
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_no_attested_data"});
      return;
    }

    const {attestedHeader} = attestedData;
    const attestedPeriod = computeSyncPeriodAtSlot(attestedHeader.beacon.slot);
    if (syncPeriod !== attestedPeriod) {
      this.logger.debug("attested data period different than signature period", {syncPeriod, attestedPeriod});
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_attested_period_diff"});
      return;
    }

    const headerUpdate: LightClientOptimisticUpdate = {
      attestedHeader,
      syncAggregate,
      signatureSlot,
    };

    const syncAggregateParticipation = sumBits(syncAggregate.syncCommitteeBits);

    if (syncAggregateParticipation < MIN_SYNC_COMMITTEE_PARTICIPANTS) {
      this.logger.debug("sync committee below required MIN_SYNC_COMMITTEE_PARTICIPANTS", {
        syncPeriod,
        attestedPeriod,
        syncAggregateParticipation,
      });
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_sync_committee_low"});
      return;
    }

    // Fork of LightClientOptimisticUpdate and LightClientFinalityUpdate is based off on attested header's fork
    const attestedFork = this.config.getForkName(attestedHeader.beacon.slot);

    // Check if node is syncing / too far behind to avoid emitting stale light client updates
    const isStaleLightClientUpdate = this.clock.currentSlot - signatureSlot > SLOTS_PER_EPOCH;

    if (!isStaleLightClientUpdate) {
      // Emit update
      // Note: Always emit optimistic update even if we have emitted one with higher or equal attested_header.slot
      this.emitter.emit(routes.events.EventType.lightClientOptimisticUpdate, {
        version: attestedFork,
        data: headerUpdate,
      });
    } else {
      this.metrics?.lightclientServer.staleLightClientUpdates.inc();
    }

    // Persist latest best update for getLatestHeadUpdate()
    // TODO: Once SyncAggregate are constructed from P2P too, count bits to decide "best"
    if (!this.latestHeadUpdate || attestedHeader.beacon.slot > this.latestHeadUpdate.attestedHeader.beacon.slot) {
      this.latestHeadUpdate = headerUpdate;
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "update_latest_head_update"});
    }

    const builtUpdate = await this.buildUpdate(attestedData, syncAggregate, signatureSlot);
    if (
      builtUpdate?.hasFinality &&
      (!this.finalized ||
        builtUpdate.update.finalizedHeader.beacon.slot > this.finalized.finalizedHeader.beacon.slot ||
        syncAggregateParticipation > sumBits(this.finalized.syncAggregate.syncCommitteeBits))
    ) {
      this.finalized = {
        attestedHeader,
        finalizedHeader: builtUpdate.update.finalizedHeader,
        syncAggregate,
        finalityBranch: builtUpdate.update.finalityBranch,
        signatureSlot,
      };
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "update_latest_finalized_update"});

      if (!isStaleLightClientUpdate) {
        // Note: Ignores gossip rule to always emit finality_update with higher finalized_header.slot, for simplicity
        this.emitter.emit(routes.events.EventType.lightClientFinalityUpdate, {
          version: attestedFork,
          data: this.finalized,
        });
      }
    }

    // Check if this update is better, otherwise ignore
    try {
      if (builtUpdate) {
        await this.maybeStoreNewBestUpdate(syncPeriod, builtUpdate);
      }
    } catch (e) {
      this.logger.error(
        "Error updating best LightClientUpdate",
        {syncPeriod, slot: attestedHeader.beacon.slot, blockRoot: toRootHex(attestedData.blockRoot)},
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
    built: {update: LightClientUpdate; summary: LightClientUpdateSummary}
  ): Promise<void> {
    const prevBestUpdate = await this.db.bestLightClientUpdate.get(syncPeriod);
    if (prevBestUpdate && !isBetterUpdate(built.summary, toLightClientUpdateSummary(prevBestUpdate))) {
      this.metrics?.lightclientServer.updateNotBetter.inc();
      return;
    }

    // attestedData and the block of syncAggregate may not be in same sync period
    // should not use attested data slot as sync period
    // see https://github.com/ChainSafe/lodestar/issues/3933
    await this.db.bestLightClientUpdate.put(syncPeriod, built.update);
    this.logger.debug("Stored new PartialLightClientUpdate", {
      syncPeriod,
      isFinalized: built.summary.isFinalityUpdate,
      participation: sumBits(built.update.syncAggregate.syncCommitteeBits) / SYNC_COMMITTEE_SIZE,
    });

    // Count total persisted updates per type. DB metrics don't diff between each type.
    // The frequency of finalized vs non-finalized is critical to debug if finalizedHeader is not available
    this.metrics?.lightclientServer.onSyncAggregate.inc({
      event: built.summary.isFinalityUpdate ? "store_finalized_update" : "store_nonfinalized_update",
    });
    this.metrics?.lightclientServer.highestSlot.set(
      {item: built.summary.isFinalityUpdate ? "best_finalized_update" : "best_nonfinalized_update"},
      built.update.attestedHeader.beacon.slot
    );
  }

  /**
   * Build the update for `syncAggregate` attesting to `attestedData`.
   *
   * Finality is indicated whenever it can be proven, in one of three ways:
   * - the finalized checkpoint is genesis: the branch is served, the header stays empty, since
   *   genesis cannot be proven by a header and the branch alone proves that `finalized_root` is zero
   * - the finalized header is available locally: both the header and the branch are served
   * - the finalized header is not available: neither is served, and `hasFinality` is false
   */
  private async buildUpdate(
    attestedData: SyncAttestedData,
    syncAggregate: altair.SyncAggregate,
    signatureSlot: Slot
  ): Promise<{update: LightClientUpdate; summary: LightClientUpdateSummary; hasFinality: boolean} | null> {
    const {attestedHeader} = attestedData;

    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(attestedData.blockRoot);
    if (!syncCommitteeWitness) {
      throw Error(`syncCommitteeWitness not available at ${toRootHex(attestedData.blockRoot)}`);
    }

    const attestedFork = this.config.getForkName(attestedHeader.beacon.slot);
    const numWitness = syncCommitteeWitness.witness.length;
    if (
      isForkPostGloas(attestedFork) &&
      (syncCommitteeWitness.currentSyncCommitteeBranch === undefined ||
        syncCommitteeWitness.nextSyncCommitteeBranch === undefined)
    ) {
      throw Error("Expected post-Gloas sync committee branches");
    }
    if (!isForkPostGloas(attestedFork) && isForkPostElectra(attestedFork) && numWitness !== NUM_WITNESS_ELECTRA) {
      throw Error(`Expected ${NUM_WITNESS_ELECTRA} witnesses in post-Electra numWitness=${numWitness}`);
    }
    if (!isForkPostGloas(attestedFork) && !isForkPostElectra(attestedFork) && numWitness !== NUM_WITNESS) {
      throw Error(`Expected ${NUM_WITNESS} witnesses in pre-Electra numWitness=${numWitness}`);
    }

    const nextSyncCommittee = await this.db.syncCommittee.get(syncCommitteeWitness.nextSyncCommitteeRoot);
    if (!nextSyncCommittee) {
      throw Error("nextSyncCommittee not available");
    }
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteeWitness);

    const zeroFinality = this.getZeroFinality(attestedFork, attestedHeader.beacon.slot);
    const {finalizedCheckpoint} = attestedData;
    let finalityBranch = zeroFinality.finalityBranch;
    let finalizedHeader = zeroFinality.finalizedHeader;
    let hasFinality = false;

    if (finalizedCheckpoint.epoch === GENESIS_EPOCH) {
      // Genesis cannot be proven by a header, the branch alone proves that finalized_root is zero
      finalityBranch = attestedData.finalityBranch;
      hasFinality = true;
    } else {
      const finalizedHeaderAttested = await this.getFinalizedHeader(finalizedCheckpoint.root);
      // If the finalized block is not available locally, both stay empty
      if (finalizedHeaderAttested) {
        finalityBranch = attestedData.finalityBranch;
        finalizedHeader = finalizedHeaderAttested;
        hasFinality = true;
        // Fork of LightClientUpdate is based off on attested header's fork
        if (this.config.getForkName(finalizedHeader.beacon.slot) !== attestedFork) {
          finalizedHeader = upgradeLightClientHeader(this.config, attestedFork, finalizedHeader);
        }
      }
    }

    const update = {
      attestedHeader,
      nextSyncCommittee,
      nextSyncCommitteeBranch,
      finalizedHeader,
      finalityBranch,
      syncAggregate,
      signatureSlot,
    } as LightClientUpdate;

    return {update, summary: toLightClientUpdateSummary(update), hasFinality};
  }

  private getZeroFinality(attestedFork: ForkName, attestedSlot: Slot): LightClientZeroFinality {
    let zeroFinality = this.zeroFinalityByFork.get(attestedFork);
    if (!zeroFinality) {
      const zero = this.config.getPostAltairForkTypes(attestedSlot).LightClientUpdate.defaultValue();
      zeroFinality = {finalityBranch: zero.finalityBranch, finalizedHeader: zero.finalizedHeader};
      this.zeroFinalityByFork.set(attestedFork, zeroFinality);
    }
    return zeroFinality;
  }

  private async storeSyncCommittee(syncCommittee: altair.SyncCommittee, syncCommitteeRoot: Uint8Array): Promise<void> {
    const isKnown = await this.db.syncCommittee.has(syncCommitteeRoot);
    if (!isKnown) {
      await this.db.syncCommittee.putBinary(syncCommitteeRoot, ssz.altair.SyncCommittee.serialize(syncCommittee));
    }
  }

  /**
   * Get finalized header from db. Keeps a small in-memory cache to speed up most of the lookups
   */
  private async getFinalizedHeader(finalizedBlockRoot: Uint8Array): Promise<LightClientHeader | null> {
    const finalizedBlockRootHex = toRootHex(finalizedBlockRoot);
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

export function blockToLightClientHeader(fork: ForkName, block: BeaconBlock<ForkPostAltair>): LightClientHeader {
  const beacon: phase0.BeaconBlockHeader = {
    slot: block.slot,
    proposerIndex: block.proposerIndex,
    parentRoot: block.parentRoot,
    stateRoot: block.stateRoot,
    bodyRoot: (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkPostAltair, "BeaconBlockBody">).hashTreeRoot(block.body),
  };

  if (isForkPostGloas(fork)) {
    const blockBody = block.body as BeaconBlockBody<ForkPostGloas>;
    return {
      beacon,
      executionBlockHash: blockBody.signedExecutionPayloadBid.message.parentBlockHash,
      executionBranch: getBlockBodyExecutionBlockHashProof(fork, blockBody),
    };
  }

  if (ForkSeq[fork] >= ForkSeq.capella) {
    const blockBody = block.body as BeaconBlockBody<ForkPostBellatrix & ForkPreGloas>;
    const execution = executionPayloadToPayloadHeader(ForkSeq[fork], blockBody.executionPayload);
    return {
      beacon,
      execution,
      executionBranch: getBlockBodyExecutionHeaderProof(fork as ForkPostBellatrix, blockBody),
    } as LightClientHeader;
  }

  return {beacon};
}
