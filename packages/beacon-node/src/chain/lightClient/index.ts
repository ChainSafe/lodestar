import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {
  EPOCHS_PER_SYNC_COMMITTEE_PERIOD,
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostGloas,
  ForkPreGloas,
  ForkSeq,
  GENESIS_EPOCH,
  MIN_SYNC_COMMITTEE_PARTICIPANTS,
  SLOTS_PER_EPOCH,
  isForkPostElectra,
  isForkPostGloas,
} from "@lodestar/params";
import {
  type IBeaconStateViewAltair,
  computeStartSlotAtEpoch,
  computeSyncPeriodAtEpoch,
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
  config: ChainForkConfig;
  clock: IClock;
  db: IBeaconDb;
  metrics: Metrics | null;
  emitter: ChainEventEmitter;
  logger: Logger;
  signal: AbortSignal;
};

/**
 * Per block light client data, collected on import regardless of whether the block becomes head.
 *
 * `bestUpdateRoot` / `bestUpdateSummary` track the best update derivable from the branch ending at
 * this block. Which of them is served depends on fork choice, see `updateHead`.
 */
export type BlockLightClientCache = {
  attestedHeader: LightClientHeader;
  /** Precomputed root to prevent re-hashing */
  blockRoot: Uint8Array;
  syncAggregate: altair.SyncAggregate;
  signatureSlot: Slot;
  bestUpdateRoot: BlockRooHex | null;
  bestUpdateSummary: LightClientUpdateSummary | null;
  /** Latest slot signed by at least `MIN_SYNC_COMMITTEE_PARTICIPANTS` along this branch */
  latestSignatureSlot: Slot;
  finalizedCheckpoint: phase0.Checkpoint | null;
  finalityBranch: Uint8Array[] | null;
};

const MAX_CACHED_FINALIZED_HEADERS = 3;
/**
 * Memory bound for the per block cache while finality stalls, in sync committee periods.
 *
 * This is not a correctness bound: collected data is kept until it falls below finality, see
 * `pruneBlockData`. The bound only applies when finality stalls for longer than this. On mainnet it
 * is 32768 slots, about 4.5 days, around 20 MB when full, in line with fork choice keeping every
 * non-finalized block during the same period.
 */
const MAX_CACHED_SYNC_PERIODS = 4;
const MAX_CACHED_SLOTS = MAX_CACHED_SYNC_PERIODS * EPOCHS_PER_SYNC_COMMITTEE_PERIOD * SLOTS_PER_EPOCH;

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
   * Collected per block light client data for the non-finalized range. Pruned on finalization in
   * `updateHead`.
   */
  private readonly blockData = new Map<BlockRooHex, BlockLightClientCache>();
  /**
   * Highest finalized block slot seen in an imported post state. Finalized checkpoints cannot
   * conflict, so this is monotonic and safe to prune below even before fork choice catches up.
   */
  private maxFinalizedSlot: Slot = 0;
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
  ): Promise<void> {
    // TEMP: To disable this functionality for fork_choice spec tests.
    // Since the tests have deep-reorgs attested data is not available often printing lots of error logs.
    // While this function is only called for head blocks, best to disable.
    if (this.opts.disableLightClientServerOnImportBlockHead) {
      return Promise.resolve();
    }

    return this.onImportBlock(block, postState, parentBlockSlot).catch((e) => {
      if (!this.signal.aborted) {
        this.logger.error("Error onImportBlock", {}, e);
        this.metrics?.lightclientServer.onSyncAggregate.inc({event: "error"});
      }
    });
  }

  /**
   * Register light client data for a block that is never imported, such as the genesis block or a
   * checkpoint sync anchor.
   *
   * The first imported block attests to the anchor, so without this its bootstrap is unavailable
   * and no update can be derived for the anchor's period.
   */
  async initAnchor(blockRoot: Root, header: LightClientHeader, postState: IBeaconStateViewAltair): Promise<void> {
    const syncCommitteeWitness = postState.getSyncCommitteesWitness();

    await Promise.all([
      this.storeSyncCommittee(postState.currentSyncCommittee, syncCommitteeWitness.currentSyncCommitteeRoot),
      this.storeSyncCommittee(postState.nextSyncCommittee, syncCommitteeWitness.nextSyncCommitteeRoot),
    ]);
    await this.db.syncCommitteeWitness.put(blockRoot, syncCommitteeWitness);
    await this.db.checkpointHeader.put(blockRoot, header);

    this.blockData.set(toRootHex(blockRoot), {
      attestedHeader: header,
      blockRoot,
      syncAggregate: ssz.altair.SyncAggregate.defaultValue(),
      signatureSlot: header.beacon.slot,
      bestUpdateRoot: null,
      bestUpdateSummary: null,
      latestSignatureSlot: 0,
      finalizedCheckpoint: postState.finalizedCheckpoint,
      finalityBranch: postState.getFinalizedRootProof(),
    });
    this.storedCurrentSyncCommittee = true;
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

  /**
   * Collect light client data for an imported block.
   *
   * Runs for every imported block, independent of the block becoming head. Which data is actually
   * served is decided in `updateHead`, since only canonical data may be served.
   */
  private async onImportBlock(
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

    // Store finalized checkpoint data
    // Finality is served whenever it can be proven, see `buildUpdate`
    const finalizedCheckpoint = postState.finalizedCheckpoint;
    const finalizedBlockSlot =
      this.blockData.get(toRootHex(finalizedCheckpoint.root))?.attestedHeader.beacon.slot ??
      computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
    this.maxFinalizedSlot = Math.max(this.maxFinalizedSlot, finalizedBlockSlot);

    const parentData = this.blockData.get(toRootHex(block.parentRoot));
    const candidate = this.createCandidateUpdate(block, period, parentData);

    let bestUpdateRoot: BlockRooHex | null = candidate.inheritedRoot;
    let bestUpdateSummary: LightClientUpdateSummary | null = candidate.inheritedSummary;
    // Rank by the update that would actually be served, since finality depends on what is available locally
    const built =
      candidate.isEligible && parentData
        ? await this.buildUpdate(block.body.syncAggregate, blockSlot, parentData)
        : null;
    if (built && (bestUpdateSummary === null || isBetterUpdate(built.summary, bestUpdateSummary))) {
      bestUpdateRoot = blockRootHex;
      bestUpdateSummary = built.summary;
    }

    this.blockData.set(blockRootHex, {
      attestedHeader: header,
      blockRoot,
      syncAggregate: block.body.syncAggregate,
      signatureSlot: blockSlot,
      bestUpdateRoot,
      bestUpdateSummary,
      latestSignatureSlot: candidate.latestSignatureSlot,
      finalizedCheckpoint,
      finalityBranch: postState.getFinalizedRootProof(),
    });

    // Bounds the cache in production, where `updateHead` has no caller yet. In steady state finality
    // keeps this at a couple of epochs; the slot bound only applies while finality stalls.
    this.pruneBlockData(Math.max(this.maxFinalizedSlot, blockSlot - MAX_CACHED_SLOTS));

    // Keep the served data in sync on a linear chain. Reorgs are reconciled in `updateHead`.
    if (bestUpdateRoot === blockRootHex && built) {
      const prevBestUpdate = await this.db.bestLightClientUpdate.get(period);
      if (!prevBestUpdate || isBetterUpdate(built.summary, toLightClientUpdateSummary(prevBestUpdate))) {
        await this.db.bestLightClientUpdate.put(period, built.update);
        this.metrics?.lightclientServer.onSyncAggregate.inc({
          event: built.summary.isFinalityUpdate ? "store_finalized_update" : "store_nonfinalized_update",
        });
      }
    }

    await this.updateLatestOnImport(blockRootHex, block, parentData, built);
  }

  /**
   * Whether the `sync_aggregate` of `block` may yield an update, and what it inherits from its parent.
   *
   * The aggregate is ignored when the sync committee did not reach `MIN_SYNC_COMMITTEE_PARTICIPANTS`
   * or when `attested_header` falls in a different period. A period's best update is not inherited
   * across periods.
   */
  private createCandidateUpdate(
    block: BeaconBlock<ForkPostAltair>,
    period: SyncPeriod,
    parentData: BlockLightClientCache | undefined
  ): {
    isEligible: boolean;
    inheritedRoot: BlockRooHex | null;
    inheritedSummary: LightClientUpdateSummary | null;
    latestSignatureSlot: Slot;
  } {
    if (!parentData) {
      return {isEligible: false, inheritedRoot: null, inheritedSummary: null, latestSignatureSlot: 0};
    }

    const attestedPeriod = computeSyncPeriodAtSlot(parentData.attestedHeader.beacon.slot);
    const activeParticipants = sumBits(block.body.syncAggregate.syncCommitteeBits);
    const samePeriod = attestedPeriod === period;
    const hasParticipation = activeParticipants >= MIN_SYNC_COMMITTEE_PARTICIPANTS;

    return {
      isEligible: samePeriod && hasParticipation,
      inheritedRoot: samePeriod ? parentData.bestUpdateRoot : null,
      inheritedSummary: samePeriod ? parentData.bestUpdateSummary : null,
      latestSignatureSlot: hasParticipation ? block.slot : parentData.latestSignatureSlot,
    };
  }

  /**
   * Build the full update for `syncAggregate` attesting to `attestedData`.
   *
   * Returns `null` if the referenced sync committee is not available locally.
   */
  private async buildUpdate(
    syncAggregate: altair.SyncAggregate,
    signatureSlot: Slot,
    attestedData: BlockLightClientCache
  ): Promise<{update: LightClientUpdate; summary: LightClientUpdateSummary; hasFinality: boolean} | null> {
    const {attestedHeader} = attestedData;

    const syncCommitteeWitness = await this.db.syncCommitteeWitness.get(attestedData.blockRoot);
    if (!syncCommitteeWitness) {
      this.logger.debug("syncCommitteeWitness not available", {root: toRootHex(attestedData.blockRoot)});
      return null;
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
      this.logger.debug("nextSyncCommittee not available", {root: toRootHex(attestedData.blockRoot)});
      return null;
    }
    const nextSyncCommitteeBranch = getNextSyncCommitteeBranch(syncCommitteeWitness);

    const zeroFinality = this.getZeroFinality(attestedFork, attestedHeader.beacon.slot);
    const finalizedCheckpoint = attestedData.finalizedCheckpoint;
    let finalityBranch = zeroFinality.finalityBranch;
    let finalizedHeader = zeroFinality.finalizedHeader;
    let hasFinality = false;

    // Finality is indicated in three cases: genesis serves the branch with an empty header, an
    // available finalized header is served together with the branch, and when neither is available
    // nothing is served.
    if (finalizedCheckpoint && attestedData.finalityBranch) {
      if (finalizedCheckpoint.epoch === GENESIS_EPOCH) {
        finalityBranch = attestedData.finalityBranch;
        hasFinality = true;
      } else {
        const finalizedHeaderAttested = await this.getFinalizedHeader(finalizedCheckpoint.root);
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

  /**
   * Update latest finality / optimistic updates on import, for a linear chain.
   *
   * `updateHead` recomputes both from the canonical chain after a reorg.
   */
  private async updateLatestOnImport(
    blockRootHex: BlockRooHex,
    block: BeaconBlock<ForkPostAltair>,
    attestedData: BlockLightClientCache | undefined,
    built: Awaited<ReturnType<LightClientServer["buildUpdate"]>>
  ): Promise<void> {
    if (!attestedData) {
      this.logger.debug("attestedData not available", {root: blockRootHex, cacheSize: this.blockData.size});
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_no_attested_data"});
      return;
    }

    const syncAggregate = block.body.syncAggregate;
    const syncAggregateParticipation = sumBits(syncAggregate.syncCommitteeBits);
    if (syncAggregateParticipation < MIN_SYNC_COMMITTEE_PARTICIPANTS) {
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "ignore_sync_committee_low"});
      return;
    }

    const headerUpdate: LightClientOptimisticUpdate = {
      attestedHeader: attestedData.attestedHeader,
      syncAggregate,
      signatureSlot: block.slot,
    };

    const attestedFork = this.config.getForkName(attestedData.attestedHeader.beacon.slot);
    // Check if node is syncing / too far behind to avoid emitting stale light client updates
    const isStaleLightClientUpdate = this.clock.currentSlot - block.slot > SLOTS_PER_EPOCH;

    if (!isStaleLightClientUpdate) {
      this.emitter.emit(routes.events.EventType.lightClientOptimisticUpdate, {
        version: attestedFork,
        data: headerUpdate,
      });
    } else {
      this.metrics?.lightclientServer.staleLightClientUpdates.inc();
    }

    if (
      !this.latestHeadUpdate ||
      attestedData.attestedHeader.beacon.slot > this.latestHeadUpdate.attestedHeader.beacon.slot
    ) {
      this.latestHeadUpdate = headerUpdate;
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "update_latest_head_update"});
    }

    if (!attestedData.finalizedCheckpoint) {
      return;
    }

    const update = built;
    if (!update?.hasFinality) {
      return;
    }

    const {finalizedHeader, finalityBranch} = update.update;
    if (
      !this.finalized ||
      finalizedHeader.beacon.slot > this.finalized.finalizedHeader.beacon.slot ||
      syncAggregateParticipation > sumBits(this.finalized.syncAggregate.syncCommitteeBits)
    ) {
      this.finalized = {
        attestedHeader: attestedData.attestedHeader,
        finalizedHeader,
        finalityBranch,
        syncAggregate,
        signatureSlot: block.slot,
      };
      this.metrics?.lightclientServer.onSyncAggregate.inc({event: "update_latest_finalized_update"});

      if (!isStaleLightClientUpdate) {
        this.emitter.emit(routes.events.EventType.lightClientFinalityUpdate, {
          version: attestedFork,
          data: this.finalized,
        });
      }
    }
  }

  /**
   * Reconcile served light client data with the canonical chain selected by fork choice.
   *
   * Must be called whenever the head changes. Data derived from orphaned blocks is replaced or
   * removed, and the latest finality / optimistic updates are recomputed from the new head.
   */
  async updateHead(headBlockRoot: Root, finalizedCheckpoint: phase0.Checkpoint): Promise<void> {
    const headData = this.blockData.get(toRootHex(headBlockRoot));

    // When the first slots of the finalized epoch are empty, the finalized block sits at a later slot
    // than its epoch start and is still referable by checkpoints of that epoch.
    const finalizedSlot =
      this.blockData.get(toRootHex(finalizedCheckpoint.root))?.attestedHeader.beacon.slot ??
      computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
    this.pruneBlockData(finalizedSlot);

    if (!headData) {
      this.logger.debug("updateHead without collected data", {headBlockRoot: toRootHex(headBlockRoot)});
      return;
    }

    const lowPeriod = computeSyncPeriodAtEpoch(finalizedCheckpoint.epoch);
    const headPeriod = computeSyncPeriodAtSlot(headData.attestedHeader.beacon.slot);

    for (let period = lowPeriod; period <= headPeriod; period++) {
      const periodEndSlot = computeStartSlotAtEpoch((period + 1) * EPOCHS_PER_SYNC_COMMITTEE_PERIOD) - 1;
      const ancestor = this.getAncestorAtSlot(headData, periodEndSlot);
      // The branch is not cached down to this period, leave the remaining periods untouched
      if (!ancestor || ancestor.attestedHeader.beacon.slot < finalizedSlot) {
        break;
      }

      const bestRoot = ancestor.bestUpdateRoot;
      const bestData = bestRoot === null ? null : (this.blockData.get(bestRoot) ?? null);
      const attestedData = bestData
        ? (this.blockData.get(toRootHex(bestData.attestedHeader.beacon.parentRoot)) ?? null)
        : null;
      const stored = await this.db.bestLightClientUpdate.get(period);

      if (bestRoot === null) {
        if (stored) {
          await this.db.bestLightClientUpdate.delete(period);
        }
        continue;
      }
      // Cut by the memory bound, what is cached may be older than what is served
      if (!bestData || !attestedData) {
        continue;
      }
      if (stored && isSameServedUpdate(stored, bestData, attestedData)) {
        continue;
      }

      const update = await this.buildUpdate(bestData.syncAggregate, bestData.signatureSlot, attestedData);
      if (update) {
        await this.db.bestLightClientUpdate.put(period, update.update);
      }
    }

    await this.updateLatestOnHead(headData);
  }

  /**
   * Recompute the latest finality / optimistic updates from the canonical chain ending at `headData`.
   */
  private async updateLatestOnHead(headData: BlockLightClientCache): Promise<void> {
    const signatureSlot = headData.latestSignatureSlot;
    if (signatureSlot === 0) {
      this.latestHeadUpdate = null;
      this.finalized = null;
      return;
    }

    const signatureData = this.getAncestorAtSlot(headData, signatureSlot);
    if (!signatureData || signatureData.attestedHeader.beacon.slot !== signatureSlot) {
      this.latestHeadUpdate = null;
      this.finalized = null;
      return;
    }

    const attestedData = this.blockData.get(toRootHex(signatureData.attestedHeader.beacon.parentRoot));
    if (!attestedData) {
      this.latestHeadUpdate = null;
      this.finalized = null;
      return;
    }

    const update = await this.buildUpdate(signatureData.syncAggregate, signatureSlot, attestedData);
    if (!update) {
      return;
    }

    const {update: fullUpdate} = update;
    const attestedFork = this.config.getForkName(fullUpdate.attestedHeader.beacon.slot);

    this.latestHeadUpdate = {
      attestedHeader: fullUpdate.attestedHeader,
      syncAggregate: fullUpdate.syncAggregate,
      signatureSlot: fullUpdate.signatureSlot,
    };
    this.finalized = update.hasFinality
      ? {
          attestedHeader: fullUpdate.attestedHeader,
          finalizedHeader: fullUpdate.finalizedHeader,
          finalityBranch: fullUpdate.finalityBranch,
          syncAggregate: fullUpdate.syncAggregate,
          signatureSlot: fullUpdate.signatureSlot,
        }
      : null;

    const isStaleLightClientUpdate = this.clock.currentSlot - signatureSlot > SLOTS_PER_EPOCH;
    if (!isStaleLightClientUpdate) {
      this.emitter.emit(routes.events.EventType.lightClientOptimisticUpdate, {
        version: attestedFork,
        data: this.latestHeadUpdate,
      });
      if (this.finalized) {
        this.emitter.emit(routes.events.EventType.lightClientFinalityUpdate, {
          version: attestedFork,
          data: this.finalized,
        });
      }
    }
  }

  /**
   * Walk the canonical chain from `blockData` back to `slot`.
   *
   * Only blocks collected in `blockData` can be walked, which covers the non-finalized range.
   */
  private getAncestorAtSlot(blockData: BlockLightClientCache, slot: Slot): BlockLightClientCache | null {
    let current: BlockLightClientCache | undefined = blockData;
    while (current && current.attestedHeader.beacon.slot > slot) {
      current = this.blockData.get(toRootHex(current.attestedHeader.beacon.parentRoot));
    }
    return current ?? null;
  }

  /**
   * Drop collected data below `lowSlot`, see `MAX_CACHED_SYNC_PERIODS`.
   */
  private pruneBlockData(lowSlot: Slot): void {
    for (const [rootHex, data] of this.blockData) {
      if (data.attestedHeader.beacon.slot < lowSlot) {
        this.blockData.delete(rootHex);
      }
    }
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

/**
 * Whether `stored` is the update built from the sync aggregate of `signatureData` attesting to
 * `attestedData`.
 *
 * Summaries cannot identify an update: two branches can produce identical ones while only one is
 * canonical, and `is_better_update` cannot be used here since it prefers higher participation.
 */
function isSameServedUpdate(
  stored: LightClientUpdate,
  signatureData: BlockLightClientCache,
  attestedData: BlockLightClientCache
): boolean {
  return (
    stored.signatureSlot === signatureData.signatureSlot &&
    ssz.phase0.BeaconBlockHeader.equals(stored.attestedHeader.beacon, attestedData.attestedHeader.beacon)
  );
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
