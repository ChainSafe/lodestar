import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {
  AncestorStatus,
  BlockExecutionStatus,
  CheckpointWithHex,
  EpochDifference,
  ExecutionStatus,
  ForkChoiceError,
  ForkChoiceErrorCode,
  ForkChoiceStateGetter,
  IForkChoice,
  LVHExecResponse,
  NotReorgedReason,
  PayloadExecutionStatus,
  PayloadStatus,
  ProtoBlock,
  ProtoNode,
  UpdateHeadOpt,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import type {LoggerNode} from "@lodestar/logger/node";
import {
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkName,
  ForkPostAltair,
  ForkPostBellatrix,
  ForkPostElectra,
  ForkSeq,
  GENESIS_SLOT,
  MAX_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SUBNET_SIZE,
  isForkPostBellatrix,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  EffectiveBalanceIncrements,
  EpochShuffling,
  IBeaconStateView,
  IBeaconStateViewBellatrix,
  IBeaconStateViewGloas,
  PubkeyCache,
  RootCache,
  StateHashTreeRootSource,
  calculateCommitteeAssignments,
  computeEndSlotAtEpoch,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  getCurrentEpoch,
  getEffectiveBalancesFromStateBytes,
  getIndexedAttestation,
  isStartSlotOfEpoch,
  isStatePostAltair,
  isStatePostBellatrix,
  isStatePostCapella,
  isStatePostElectra,
  isStatePostFulu,
  isStatePostGloas,
  proposerShufflingDecisionRoot,
} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BLSPubkey,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  Bytes32,
  CommitteeIndex,
  Epoch,
  Gwei,
  IndexedAttestation,
  Root,
  RootHex,
  SSEPayloadAttributes,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SingleAttestation,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
  altair,
  capella,
  deneb,
  electra,
  fulu,
  getValidatorStatus,
  gloas,
  isGloasBeaconBlock,
  phase0,
  rewards,
  ssz,
} from "@lodestar/types";
import {Logger, byteArrayEquals, fromHex, sleep, toRootHex} from "@lodestar/utils";
import {GENESIS_EPOCH, ZERO_HASH, ZERO_HASH_HEX} from "../../constants/index.js";
import {IBeaconEngineDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {BufferPool} from "../../util/bufferPool.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {BlockRootSlot, getSlotFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";
import {HistoricalStateRegen} from "../archiveStore/historicalState/historicalStateRegen.js";
import {ArchiveMode, ArchiveStoreTask, StateArchiveStrategy} from "../archiveStore/interface.js";
import {FrequencyStateArchiveStrategy} from "../archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {
  migrateFinalizedBlocks,
  migrateFinalizedExecutionPayloadEnvelopes,
} from "../archiveStore/utils/archiveBlocks.js";
import {pruneHistory} from "../archiveStore/utils/pruneHistory.js";
import {CheckpointBalancesCache} from "../balancesCache.js";
import {BeaconProposerCache, ProposerPreparationData} from "../beaconProposerCache.js";
import {isBlockInputBlobs, isBlockInputColumns} from "../blocks/blockInput/blockInput.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {PayloadError, PayloadErrorCode} from "../blocks/payloadError.js";
import {AttestationImportOpt, ImportBlockOpts} from "../blocks/types.js";
import {getCheckpointFromState} from "../blocks/utils/checkpoint.js";
import {verifyBlocksSignatures} from "../blocks/verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "../blocks/verifyBlocksStateTransitionOnly.js";
import {
  verifyExecutionPayloadEnvelope as verifyExecutionPayloadEnvelopeFields,
  verifyExecutionPayloadEnvelopeSignature,
} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {ChainEvent, ChainEventEmitter, ReorgEventData} from "../emitter.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {ForkchoiceCaller, initializeForkChoice} from "../forkChoice/index.js";
import {CommonBlockBody, FindHeadFnName, StateGetOpts} from "../interface.js";
import {LightClientServer} from "../lightClient/index.js";
import {
  AggregatedAttestationPool,
  AttestationPool,
  ExecutionPayloadBidPool,
  OpPool,
  PayloadAttestationPool,
  ProposerPreferencesPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "../opPools/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {BlockProcessOpts} from "../options.js";
import {
  BlockAttributes,
  BlockProductionStep,
  BlockType,
  PayloadAttributesInput,
  PayloadAttributesWithdrawals,
  preparePayloadAttributes,
} from "../produceBlock/produceBlockBody.js";
import {QueuedStateRegenerator, RegenCaller, RegenRequest} from "../regen/index.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockInput,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenExecutionPayloadBids,
  SeenPayloadAttesters,
  SeenProposerPreferences,
  SeenSyncCommitteeMessages,
} from "../seenCache/index.js";
import {SeenAggregatedAttestations} from "../seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "../seenCache/seenAttestationData.js";
import {SeenBlockAttesters} from "../seenCache/seenBlockAttesters.js";
import {ShufflingCache} from "../shufflingCache.js";
import {FIFOBlockStateCache} from "../stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache, toCheckpointHex} from "../stateCache/persistentCheckpointsCache.js";
import {BlockStateCache, CheckpointHex, CheckpointStateCache} from "../stateCache/types.js";
import {validateApiAggregateAndProof, validateGossipAggregateAndProof} from "../validation/aggregateAndProof.js";
import {
  ApiAttestation,
  AttestationValidationResult,
  GossipAttestation,
  validateApiAttestation,
  validateGossipAttestationsSameAttData,
} from "../validation/attestation.js";
import {validateApiAttesterSlashing, validateGossipAttesterSlashing} from "../validation/attesterSlashing.js";
import {validateGossipBlobSidecar} from "../validation/blobSidecar.js";
import {GossipBlockValidationResult, validateGossipBlock} from "../validation/block.js";
import {
  validateApiBlsToExecutionChange,
  validateGossipBlsToExecutionChange,
} from "../validation/blsToExecutionChange.js";
import {
  validateGossipFuluDataColumnSidecar,
  validateGossipGloasDataColumnSidecar,
} from "../validation/dataColumnSidecar.js";
import {validateApiExecutionPayloadBid, validateGossipExecutionPayloadBid} from "../validation/executionPayloadBid.js";
import {
  validateApiExecutionPayloadEnvelope,
  validateGossipExecutionPayloadEnvelope,
} from "../validation/executionPayloadEnvelope.js";
import {
  PayloadAttestationValidationResult,
  validateApiPayloadAttestationMessage,
  validateGossipPayloadAttestationMessage,
} from "../validation/payloadAttestationMessage.js";
import {validateGossipProposerPreferences} from "../validation/proposerPreferences.js";
import {validateApiProposerSlashing, validateGossipProposerSlashing} from "../validation/proposerSlashing.js";
import {validateApiSyncCommittee, validateGossipSyncCommittee} from "../validation/syncCommittee.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../validation/syncCommitteeContributionAndProof.js";
import {validateApiVoluntaryExit, validateGossipVoluntaryExit} from "../validation/voluntaryExit.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {computeNewStateRoot} from "./computeNewStateRoot.js";
import {getPubkeysForIndices} from "./duties.js";
import {
  GossipValidationResult,
  GossipValidationStatus,
  fromResult,
  runGossipValidation,
} from "./gossipValidationResult.js";
import {
  ApiStateResult,
  ApiStateResultWithFork,
  BeaconEngineModules,
  FcuUpdate,
  FinalizedProtoSummary,
  IBeaconEngine,
  ImportBlockResult,
  MigrateFinalizedResult,
  PrepareNextSlotResult,
  ProduceBlockBaseResult,
} from "./interface.js";
import {IBeaconEngineOptions} from "./options.js";

type VerifiedBlockBundle = {
  postState: IBeaconStateView;
  blockInput: IBlockInput;
  indexedAttestations: IndexedAttestation[];
  proposerBalanceDelta: number;
  parentBlockSlot: number;
  seenTimestampSec: number;
};

/* We don't want to do more epoch transition than this in prepareForNextSlot */
const PREPARE_EPOCH_LIMIT = 1;

/**
 * JS implementation of the consensus engine. Transitional in Phase 0: constructed inside
 * `BeaconChain` from the `anchorState` object; construction moves to the CLI in Phase 6.
 *
 * Minimal by design — collaborators, state ownership and flows migrate here in later phases.
 */
export class BeaconEngine implements IBeaconEngine {
  readonly config: BeaconConfig;
  readonly opts: IBeaconEngineOptions;
  private readonly logger: Logger;
  readonly metrics: Metrics | null;
  readonly clock: IClock;
  readonly pubkeyCache: PubkeyCache;
  // NodeJS-specific memory pool for state serialization; engine-internal (not on IBeaconEngine).
  readonly bufferPool: BufferPool;
  readonly bls: IBlsVerifier;
  readonly shufflingCache: ShufflingCache;

  readonly blockStateCache: BlockStateCache;
  readonly checkpointStateCache: CheckpointStateCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;
  // TODO - beacon engine: implement IForkchoiceRead interface
  readonly forkChoice: IForkChoice;
  readonly regen: QueuedStateRegenerator;

  // Op pools
  readonly attestationPool: AttestationPool;
  readonly aggregatedAttestationPool: AggregatedAttestationPool;
  readonly syncCommitteeMessagePool: SyncCommitteeMessagePool;
  readonly syncContributionAndProofPool: SyncContributionAndProofPool;
  readonly payloadAttestationPool: PayloadAttestationPool;
  readonly executionPayloadBidPool = new ExecutionPayloadBidPool();
  readonly proposerPreferencesPool = new ProposerPreferencesPool();
  readonly opPool: OpPool;
  readonly beaconProposerCache: BeaconProposerCache;

  // Consensus gossip seen-caches
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenPayloadAttesters = new SeenPayloadAttesters();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof: SeenContributionAndProof;
  readonly seenAttestationDatas: SeenAttestationDatas;
  readonly seenBlockProposers = new SeenBlockProposers();
  // Liveness cache: attesters seen through imported blocks (populated in _importBlock).
  readonly seenBlockAttesters = new SeenBlockAttesters();
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenExecutionPayloadBids = new SeenExecutionPayloadBids();
  readonly seenProposerPreferences = new SeenProposerPreferences();

  // TODO - beacon engine: how to remove this?
  readonly seenBlockInputCache: SeenBlockInput;
  readonly validatorMonitor: ValidatorMonitor | null;
  // Engine reads execution payload envelopes for block production (getParentExecutionRequests). Writes
  // / archival / network handlers still use the shared `db` directly until the DB-ownership phase.
  readonly db: IBeaconEngineDb;
  // Engine owns state archival (states DB). Finalized-state archive runs inside migrateFinalized; the
  // facade delegates temp-state (onCheckpoint) and shutdown persistence to engine methods.
  private readonly stateArchiveStrategy: StateArchiveStrategy;
  // Historical (below-finalized) state serving via a worker thread; built lazily on --serveHistoricalState.
  private historicalStateRegen?: HistoricalStateRegen;
  private readonly dbName: string;
  private readonly signal: AbortSignal;
  lightClientServer: LightClientServer | undefined;
  private readonly verifiedBlocks = new Map<string, VerifiedBlockBundle>();
  private readonly emitter: ChainEventEmitter;
  // Genesis block root is invariant; computed lazily from state for the genesis-shuffling duty fallback.
  private cachedGenesisBlockRoot: Root | null = null;

  constructor(modules: BeaconEngineModules, anchorState: IBeaconStateView) {
    const {
      opts,
      config,
      logger,
      metrics,
      clock,
      pubkeyCache,
      cpStateDatastore,
      emitter,
      signal,
      db,
      validatorMonitor,
      seenBlockInputCache,
      isAnchorStateFinalized,
    } = modules;
    this.config = config;
    this.opts = opts;
    this.logger = logger;
    this.db = db;
    this.dbName = modules.dbName;
    this.signal = signal;
    this.metrics = metrics;
    this.clock = clock;
    this.pubkeyCache = pubkeyCache;
    // Engine owns the buffer pool; sized from the anchor state (NodeJS-specific, engine-internal).
    this.bufferPool = new BufferPool(anchorState.serializedSize(), metrics);
    this.seenBlockInputCache = seenBlockInputCache;
    this.validatorMonitor = validatorMonitor;
    this.lightClientServer = modules.lightClientServer;
    this.emitter = emitter;

    // by default, verify signatures on both main threads and worker threads
    this.bls = opts.blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics, pubkeyCache})
      : new BlsMultiThreadWorkerPool(opts, {logger, metrics, pubkeyCache});

    this.shufflingCache = new ShufflingCache(metrics, logger, opts, [
      {
        shuffling: anchorState.getPreviousShuffling(),
        decisionRoot: anchorState.previousDecisionRoot,
      },
      {
        shuffling: anchorState.getCurrentShuffling(),
        decisionRoot: anchorState.currentDecisionRoot,
      },
      {
        shuffling: anchorState.getNextShuffling(),
        decisionRoot: anchorState.nextDecisionRoot,
      },
    ]);

    this.attestationPool = new AttestationPool(config, clock, opts?.preaggregateSlotDistance, metrics);
    this.aggregatedAttestationPool = new AggregatedAttestationPool(config, metrics);
    this.syncCommitteeMessagePool = new SyncCommitteeMessagePool(config, clock, opts?.preaggregateSlotDistance);
    this.syncContributionAndProofPool = new SyncContributionAndProofPool(config, clock, metrics, logger);
    this.payloadAttestationPool = new PayloadAttestationPool(config, clock, metrics);
    this.opPool = new OpPool(config);
    this.beaconProposerCache = new BeaconProposerCache(opts);

    this.seenContributionAndProof = new SeenContributionAndProof(metrics);
    this.seenAttestationDatas = new SeenAttestationDatas(metrics, opts?.attDataCacheSlotDistance);
    this.seenAggregatedAttestations = new SeenAggregatedAttestations(metrics);

    this.blockStateCache = new FIFOBlockStateCache(opts, {metrics});
    this.checkpointStateCache = new PersistentCheckpointStateCache(
      {
        config,
        metrics,
        logger,
        clock,
        blockStateCache: this.blockStateCache,
        bufferPool: this.bufferPool,
        datastore: cpStateDatastore,
      },
      opts
    );

    const {checkpoint} = anchorState.computeAnchorCheckpoint();
    this.blockStateCache.add(anchorState);
    this.blockStateCache.setHeadState(anchorState);
    this.checkpointStateCache.add(checkpoint, anchorState);

    this.checkpointBalancesCache = new CheckpointBalancesCache();

    const forkChoiceStateGetter: ForkChoiceStateGetter = ({stateRoot, checkpoint}) => {
      if (stateRoot) return this.blockStateCache.get(stateRoot);

      if (checkpoint) return this.checkpointStateCache.get({epoch: checkpoint.epoch, rootHex: checkpoint.rootHex});

      return null;
    };

    this.forkChoice = initializeForkChoice(
      config,
      emitter,
      clock.currentSlot,
      anchorState,
      isAnchorStateFinalized,
      opts,
      this.justifiedBalancesGetter.bind(this),
      forkChoiceStateGetter,
      metrics,
      logger
    );

    this.regen = new QueuedStateRegenerator({
      config,
      forkChoice: this.forkChoice,
      blockStateCache: this.blockStateCache,
      checkpointStateCache: this.checkpointStateCache,
      seenBlockInputCache,
      db,
      metrics,
      validatorMonitor,
      logger,
      emitter,
      signal,
    });

    // Engine owns the states DB, so it owns the state-archive strategy (finalized + temp + shutdown).
    if (opts.archiveMode === ArchiveMode.Frequency) {
      this.stateArchiveStrategy = new FrequencyStateArchiveStrategy(this.regen, db, logger, opts, this.bufferPool);
    } else {
      throw new Error(`State archive strategy "${opts.archiveMode}" currently not supported.`);
    }

    // The engine prunes its OWN caches on the clock tick (the facade no longer reaches in). More
    // engine-owned pools/caches move under this listener in later slices.
    clock.addListener(ClockEvent.slot, (slot: Slot) => {
      this.attestationPool.prune(slot);
      this.aggregatedAttestationPool.prune(slot);
      this.syncCommitteeMessagePool.prune(slot);
      this.payloadAttestationPool.prune(slot);
      this.executionPayloadBidPool.prune(slot);
      this.seenProposerPreferences.prune(slot);
      this.proposerPreferencesPool.prune(slot);
      this.seenSyncCommitteeMessages.prune(slot);
      this.seenExecutionPayloadBids.prune(slot);
      this.seenAttestationDatas.onSlot(slot);
    });
    clock.addListener(ClockEvent.epoch, (epoch: Epoch) => {
      this.seenAttesters.prune(epoch);
      this.seenAggregators.prune(epoch);
      this.seenPayloadAttesters.prune(epoch);
      this.seenAggregatedAttestations.prune(epoch);
      this.seenBlockAttesters.prune(epoch);
      this.beaconProposerCache.prune(epoch);
    });

    // The engine reports metrics for its own (internal) op pools.
    if (metrics) {
      metrics.clockSlot.addCollect(() => {
        metrics.opPool.attesterSlashingPoolSize.set(this.opPool.attesterSlashingsSize);
        metrics.opPool.proposerSlashingPoolSize.set(this.opPool.proposerSlashingsSize);
        metrics.opPool.voluntaryExitPoolSize.set(this.opPool.voluntaryExitsSize);
        metrics.opPool.blsToExecutionChangePoolSize.set(this.opPool.blsToExecutionChangeSize);
        metrics.opPool.attestationPool.size.set(this.attestationPool.getAttestationCount());
        metrics.opPool.syncCommitteeMessagePoolSize.set(this.syncCommitteeMessagePool.size);
        metrics.opPool.payloadAttestationPool.size.set(this.payloadAttestationPool.size);
        metrics.opPool.executionPayloadBidPool.size.set(this.executionPayloadBidPool.size);
      });
    }
  }

  getHeadState(): IBeaconStateView {
    // head state should always exist
    const head = this.forkChoice.getHead();
    const headState = this.regen.getClosestHeadState(head);
    if (!headState) {
      throw Error(`headState does not exist for head root=${head.blockRoot} slot=${head.slot}`);
    }
    return headState;
  }

  /** Head state advanced to the current wall-clock epoch (mirrors the former `chain.getHeadStateAtCurrentEpoch`). */
  async getHeadStateAtCurrentEpoch(regenCaller: RegenCaller): Promise<IBeaconStateView> {
    return this.getHeadStateAtEpoch(this.clock.currentEpoch, regenCaller);
  }

  /**
   * Regenerate state for attestation verification, this does not happen with default chain option of maxSkipSlots = 32 .
   * However, need to handle just in case. Lodestar doesn't support multiple regen state requests for attestation verification
   * at the same time, bounded inside "ShufflingCache.insertPromise()" function.
   * Leave this function in chain instead of attestatation verification code to make sure we're aware of its performance impact.
   */
  async regenStateForAttestationVerification(
    attEpoch: Epoch,
    shufflingDependentRoot: RootHex,
    attHeadBlock: ProtoBlock,
    regenCaller: RegenCaller
  ): Promise<EpochShuffling> {
    // this is to prevent multiple calls to get shuffling for the same epoch and dependent root
    // any subsequent calls of the same epoch and dependent root will wait for this promise to resolve
    this.shufflingCache.insertPromise(attEpoch, shufflingDependentRoot);
    const blockEpoch = computeEpochAtSlot(attHeadBlock.slot);

    let state: IBeaconStateView;
    if (blockEpoch < attEpoch - 1) {
      // thanks to one epoch look ahead, we don't need to dial up to attEpoch
      const targetSlot = computeStartSlotAtEpoch(attEpoch - 1);
      this.metrics?.gossipAttestation.useHeadBlockStateDialedToTargetEpoch.inc({caller: regenCaller});
      state = await this.regen.getBlockSlotState(attHeadBlock, targetSlot, {dontTransferCache: true}, regenCaller);
    } else if (blockEpoch > attEpoch) {
      // should not happen, handled inside attestation verification code
      throw Error(`Block epoch ${blockEpoch} is after attestation epoch ${attEpoch}`);
    } else {
      // should use either current or next shuffling of head state
      // it's not likely to hit this since these shufflings are cached already
      // so handle just in case
      this.metrics?.gossipAttestation.useHeadBlockState.inc({caller: regenCaller});
      state = await this.regen.getState(attHeadBlock.stateRoot, regenCaller);
    }
    // resolve the promise to unblock other calls of the same epoch and dependent root
    this.shufflingCache.processState(state);
    return state.getShufflingAtEpoch(attEpoch);
  }

  getProposerHead(slot: Slot): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: FindHeadFnName.getProposerHead});
    const secFromSlot = this.clock.secFromSlot(slot);

    try {
      const {head, isHeadTimely, notReorgedReason} = this.forkChoice.updateAndGetHead({
        mode: UpdateHeadOpt.GetProposerHead,
        secFromSlot,
        slot,
      });

      if (isHeadTimely && notReorgedReason !== undefined) {
        this.metrics?.forkChoice.notReorgedReason.inc({reason: notReorgedReason});
      }
      return head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetProposerHead});
      throw e;
    } finally {
      timer?.();
    }
  }

  // --- TODO - beacon engine: temp forkChoice read pass-throughs (curate when regen removed — BLK-3). ---
  getHead(): ProtoBlock {
    return this.forkChoice.getHead();
  }
  getHeadRoot(): RootHex {
    return this.forkChoice.getHeadRoot();
  }
  getHeads(): ProtoBlock[] {
    return this.forkChoice.getHeads();
  }
  getFinalizedCheckpoint(): CheckpointWithHex {
    return this.forkChoice.getFinalizedCheckpoint();
  }
  getJustifiedCheckpoint(): CheckpointWithHex {
    return this.forkChoice.getJustifiedCheckpoint();
  }
  getUnrealizedJustifiedCheckpoint(): CheckpointWithHex {
    return this.forkChoice.getUnrealizedJustifiedCheckpoint();
  }
  getUnrealizedFinalizedCheckpoint(): CheckpointWithHex {
    return this.forkChoice.getUnrealizedFinalizedCheckpoint();
  }
  getProposerBoostRoot(): RootHex {
    return this.forkChoice.getProposerBoostRoot();
  }
  getPreviousProposerBoostRoot(): RootHex {
    return this.forkChoice.getPreviousProposerBoostRoot();
  }
  getPTCVoteCounts(
    blockRootHex: RootHex
  ): {attesterCount: number; payloadPresentCount: number; dataAvailableCount: number} | null {
    return this.forkChoice.getPTCVoteCounts(blockRootHex);
  }
  getFinalizedBlock(): ProtoBlock {
    return this.forkChoice.getFinalizedBlock();
  }
  getJustifiedBlock(): ProtoBlock {
    return this.forkChoice.getJustifiedBlock();
  }
  getConfirmedRoot(): RootHex {
    return this.forkChoice.getConfirmedRoot();
  }
  getConfirmedBlock(): ProtoBlock | null {
    return this.forkChoice.getConfirmedBlock();
  }
  getBlockDefaultStatus(blockRoot: Root): ProtoBlock | null {
    return this.forkChoice.getBlockDefaultStatus(blockRoot);
  }
  getBlockHexDefaultStatus(blockRoot: RootHex): ProtoBlock | null {
    return this.forkChoice.getBlockHexDefaultStatus(blockRoot);
  }
  getBlockHex(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock | null {
    return this.forkChoice.getBlockHex(blockRoot, payloadStatus);
  }
  getBlockHexAndBlockHash(blockRoot: RootHex, blockHash: RootHex): ProtoBlock | null {
    return this.forkChoice.getBlockHexAndBlockHash(blockRoot, blockHash);
  }
  getCanonicalProtoBlockAtSlot(slot: Slot): ProtoBlock | null {
    return this.forkChoice.getCanonicalBlockAtSlot(slot);
  }
  getCanonicalBlockByRoot(blockRoot: Root): ProtoBlock | null {
    return this.forkChoice.getCanonicalBlockByRoot(blockRoot);
  }
  getCanonicalBlockClosestLteSlot(slot: Slot): ProtoBlock | null {
    return this.forkChoice.getCanonicalBlockClosestLteSlot(slot);
  }
  getBlockSummariesAtSlot(slot: Slot): ProtoBlock[] {
    return this.forkChoice.getBlockSummariesAtSlot(slot);
  }
  getBlockSummariesByParentRoot(parentRoot: RootHex): ProtoBlock[] {
    return this.forkChoice.getBlockSummariesByParentRoot(parentRoot);
  }
  getAllAncestorBlocks(blockRoot: RootHex, payloadStatus: PayloadStatus): ProtoBlock[] {
    return this.forkChoice.getAllAncestorBlocks(blockRoot, payloadStatus);
  }
  getAllNodes(): ProtoNode[] {
    return this.forkChoice.getAllNodes();
  }
  getSlotsPresent(windowStart: number): number {
    return this.forkChoice.getSlotsPresent(windowStart);
  }
  // TODO - beacon engine: hot path — cached in NativeBeaconEngine.
  hasBlock(blockRoot: Root): boolean {
    return this.forkChoice.hasBlock(blockRoot);
  }
  // TODO - beacon engine: hot path — cached in NativeBeaconEngine.
  hasBlockHex(blockRoot: RootHex): boolean {
    return this.forkChoice.hasBlockHex(blockRoot);
  }
  // TODO - beacon engine: hot path — cached in NativeBeaconEngine.
  hasBlockHexUnsafe(blockRoot: RootHex): boolean {
    return this.forkChoice.hasBlockHexUnsafe(blockRoot);
  }
  // TODO - beacon engine: hot path — cached in NativeBeaconEngine.
  hasPayloadHexUnsafe(blockRoot: RootHex): boolean {
    return this.forkChoice.hasPayloadHexUnsafe(blockRoot);
  }
  /** Projected thin ref (no ProtoBlock crosses) for DA-cache prune, anchored at (blockRoot, payloadStatus). */
  getAllAncestorBlockRootSlots(blockRoot: RootHex, payloadStatus: PayloadStatus): BlockRootSlot[] {
    return this.forkChoice
      .getAllAncestorBlocks(blockRoot, payloadStatus)
      .map((block) => ({slot: block.slot, root: fromHex(block.blockRoot)}));
  }

  /** DB read of an execution payload envelope. Callers that hold the DA cache check it first. */
  async getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRoot: Uint8Array
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
    return (
      (await this.db.executionPayloadEnvelope.get(blockRoot)) ??
      (await this.db.executionPayloadEnvelopeArchive.get(blockSlot)) ??
      null
    );
  }

  /** Serialized DB read of an execution payload envelope (byte sibling of getExecutionPayloadEnvelope). */
  async getSerializedExecutionPayloadEnvelope(blockSlot: Slot, blockRoot: Uint8Array): Promise<Uint8Array | null> {
    return (
      (await this.db.executionPayloadEnvelope.getBinary(blockRoot)) ??
      (await this.db.executionPayloadEnvelopeArchive.getBinary(blockSlot)) ??
      null
    );
  }

  /** Serialized read of a finalized (cold-archive, keyed by slot) execution payload envelope. */
  async getSerializedFinalizedExecutionPayloadEnvelope(slot: Slot): Promise<Uint8Array | null> {
    return (await this.db.executionPayloadEnvelopeArchive.getBinary(slot)) ?? null;
  }

  /** Persist a hot execution payload envelope, bytes-first (key = beaconBlockRoot). */
  async persistExecutionPayloadEnvelope(blockRoot: Uint8Array, serializedBytes: Uint8Array): Promise<void> {
    await this.db.executionPayloadEnvelope.putBinary(blockRoot, serializedBytes);
  }

  /**
   * Thin serving refs for ExecutionPayloadEnvelopesByRange: fork-choice reads + FULL filter stay inside
   * the engine; only slot + raw root cross. Returns the archive boundary (`finalizedSlot`) and the
   * canonical FULL blocks in `(finalizedSlot - 1, endSlot)`.
   */
  getFullBlockRootSlotsByRange(startSlot: Slot, endSlot: Slot): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]} {
    // The finalized block's envelope stays in hot db until the next finalization run → archive tops out at finalizedSlot - 1
    const finalizedSlot = this.forkChoice.getFinalizedBlock().slot;
    const archiveMaxSlot = finalizedSlot - 1;
    const nonFinalized: BlockRootSlot[] = [];
    if (endSlot > archiveMaxSlot) {
      const head = this.forkChoice.getHead();
      // newest→oldest; iterate ascending
      const headChain = this.forkChoice.getAllAncestorBlocks(head.blockRoot, head.payloadStatus);
      for (let i = headChain.length - 1; i >= 0; i--) {
        const block = headChain[i];
        if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
          // Only FULL blocks have an envelope; skip EMPTY/PENDING
          if (block.payloadStatus === PayloadStatus.FULL) {
            nonFinalized.push({slot: block.slot, root: fromHex(block.blockRoot)});
          }
        } else if (block.slot >= endSlot) {
          break;
        }
      }
    }
    return {finalizedSlot, nonFinalized};
  }

  // --- Block DB (engine-owned). Bytes-only; no SignedBeaconBlock crosses the seam. ---

  /** Serialized block by root: hot then cold. `finalized` reflects a cold-db (archive) hit. */
  async getSerializedBlockByRoot(
    root: Uint8Array
  ): Promise<{bytes: Uint8Array; slot: Slot; finalized: boolean} | null> {
    const hot = await this.db.block.getBinary(root);
    if (hot) {
      const slot = getSlotFromSignedBeaconBlockSerialized(hot);
      if (slot === null) throw Error(`Invalid block data stored in DB for root: ${toRootHex(root)}`);
      return {bytes: hot, slot, finalized: false};
    }
    const cold = await this.db.blockArchive.getBinaryEntryByRoot(root);
    return cold && {bytes: cold.value, slot: cold.key, finalized: true};
  }

  /** Serialized finalized block by slot (cold archive). */
  async getSerializedFinalizedBlockBySlot(slot: Slot): Promise<Uint8Array | null> {
    return (await this.db.blockArchive.getBinary(slot)) ?? null;
  }

  /** Finalized block slot by root (cold archive index). */
  async getFinalizedBlockSlotByRoot(root: Uint8Array): Promise<Slot | null> {
    return this.db.blockArchive.getSlotByRoot(root);
  }

  /** Serialized finalized block by parent root (cold archive index). */
  async getSerializedFinalizedBlockByParentRoot(parentRoot: Uint8Array): Promise<Uint8Array | null> {
    const slot = await this.db.blockArchive.getSlotByParentRoot(parentRoot);
    return slot !== null ? ((await this.db.blockArchive.getBinary(slot)) ?? null) : null;
  }

  /**
   * Thin serve refs for BeaconBlocksByRange: fork-choice reads stay inside the engine; only slot + raw
   * root cross. Returns the archive boundary (`finalizedSlot`, inclusive — blocks incl. the finalized
   * block migrate at finalization) and every canonical block in `(finalizedSlot, endSlot)` (no filter).
   */
  getCanonicalBlockRootSlotsByRange(
    startSlot: Slot,
    endSlot: Slot
  ): {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]} {
    const finalizedSlot = this.forkChoice.getFinalizedCheckpointSlot();
    const archiveMaxSlot = finalizedSlot;
    const nonFinalized: BlockRootSlot[] = [];
    if (endSlot > archiveMaxSlot) {
      const head = this.forkChoice.getHead();
      // newest→oldest; iterate ascending
      const headChain = this.forkChoice.getAllAncestorBlocks(head.blockRoot, head.payloadStatus);
      for (let i = headChain.length - 1; i >= 0; i--) {
        const block = headChain[i];
        if (block.slot > archiveMaxSlot && block.slot >= startSlot && block.slot < endSlot) {
          nonFinalized.push({slot: block.slot, root: fromHex(block.blockRoot)});
        } else if (block.slot >= endSlot) {
          break;
        }
      }
    }
    return {finalizedSlot, nonFinalized};
  }

  /** Persist a hot block, bytes-first (key = block root). */
  async persistBlock(root: Uint8Array, serializedBytes: Uint8Array): Promise<void> {
    await this.db.block.putBinary(root, serializedBytes);
  }

  // --- Cold block archive writes/reverse-lookup (backfill; engine-owned). Bytes-first + root/parent indexes. ---

  async persistArchiveBlock(
    slot: Slot,
    serializedBytes: Uint8Array,
    blockRoot: Uint8Array,
    parentRoot: Uint8Array
  ): Promise<void> {
    await this.db.blockArchive.batchPutBinary([{key: slot, value: serializedBytes, slot, blockRoot, parentRoot}]);
  }

  async batchPersistArchiveBlocks(
    entries: {slot: Slot; bytes: Uint8Array; blockRoot: Uint8Array; parentRoot: Uint8Array}[]
  ): Promise<void> {
    await this.db.blockArchive.batchPutBinary(
      entries.map((e) => ({
        key: e.slot,
        value: e.bytes,
        slot: e.slot,
        blockRoot: e.blockRoot,
        parentRoot: e.parentRoot,
      }))
    );
  }

  /** Nearest archived block strictly below `slot` (reverse range, limit 1) — serialized. */
  async getSerializedArchiveBlockBefore(slot: Slot): Promise<{slot: Slot; bytes: Uint8Array} | null> {
    for await (const {key, value} of this.db.blockArchive.binaryEntriesStream({lt: slot, reverse: true, limit: 1})) {
      return {slot: this.db.blockArchive.decodeKey(key), bytes: value};
    }
    return null;
  }

  /** Serialized state by state root (cold archive). */
  async getSerializedStateByRoot(stateRoot: Uint8Array): Promise<Uint8Array | null> {
    return (await this.db.stateArchive.getBinaryByRoot(stateRoot)) ?? null;
  }

  /**
   * Parent execution requests for block production. DB-only: the facade-owned DA cache is not visible
   * here, so callers that need cache-only (DB-write-pending) envelopes check the cache first
   * (`chain.getParentExecutionRequests`). At `produceBlockBase` time the parent is FULL and its
   * envelope's async DB write has normally completed.
   * TODO - beacon engine: here BeaconEngine owns the payloadEnvelope db because we need state transition for block production
   * and PrepareNextSlot. It means we always have to reach db instead of cache. See if we have any down sides with this
   */
  async getParentExecutionRequests(
    parentBlockSlot: Slot,
    parentBlockRootHex: RootHex
  ): Promise<gloas.ExecutionRequests> {
    // at the fork boundary, parent is pre-gloas
    if (!isForkPostGloas(this.config.getForkName(parentBlockSlot))) {
      return ssz.gloas.ExecutionRequests.defaultValue();
    }
    const envelope = await this.getExecutionPayloadEnvelope(parentBlockSlot, fromHex(parentBlockRootHex));
    if (envelope === null) {
      throw Error(`Parent execution payload envelope not found slot=${parentBlockSlot}, root=${parentBlockRootHex}`);
    }
    return envelope.message.executionRequests;
  }

  /**
   * Compute the shared head of block production once: proposer head, builder-bid lookup, forkChoice
   * exec hashes, and the base-state scalars the downstream flow needs. No `BeaconState` crosses — the
   * fetched state is consumed here and the (cheap, cache-hit) re-regen happens per path downstream.
   */
  async produceBlockBase({
    slot,
    randaoReveal,
    graffiti,
  }: {
    slot: Slot;
    randaoReveal: BLSSignature;
    graffiti: Bytes32;
  }): Promise<ProduceBlockBaseResult> {
    const parentBlock = this.getProposerHead(slot);
    const fork = this.config.getForkName(slot);

    const safeBlockHash = getSafeExecutionBlockHash(this.forkChoice);
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;

    // gloas: decide build-on-full, look up the best builder bid, and collect the parent block's payload
    // attestations (slot - 1) — all from engine-owned pools. Same args across both production paths.
    let isBuildingOnFull = false;
    let builderBid: gloas.SignedExecutionPayloadBid | null = null;
    let payloadAttestations: gloas.PayloadAttestation[] = [];
    if (isForkPostGloas(fork)) {
      isBuildingOnFull = this.forkChoice.shouldBuildOnFull(parentBlock, slot);
      const bidParentBlockHash = isBuildingOnFull ? parentBlock.executionPayloadBlockHash : parentBlock.parentBlockHash;
      builderBid = this.executionPayloadBidPool.getBestBid(slot, bidParentBlockHash, parentBlock.blockRoot);
      payloadAttestations = this.payloadAttestationPool.getPayloadAttestationsForBlock(parentBlock.blockRoot, slot - 1);
    }

    const state = await this.regen.getBlockSlotState(
      parentBlock,
      slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );
    const proposerIndex = state.getBeaconProposer(slot);
    const proposerPubKey = this.pubkeyCache.getOrThrow(proposerIndex).toBytes();
    const prevRandao = state.getRandaoMix(state.epoch);

    // Resolve the proposer fee recipient once (engine-owned cache); the API-requested one, if any,
    // overrides it downstream. `feeRecipientCached` distinguishes a registered value from the default
    // for block-production logging — so produceBlockBody never reaches back into the engine.
    const cachedFeeRecipient = this.beaconProposerCache.get(proposerIndex);
    const defaultFeeRecipient = this.beaconProposerCache.getOrDefault(proposerIndex);
    const feeRecipientCached = cachedFeeRecipient !== undefined;

    let parentBlockHash: Bytes32;
    // parent execution gas limit: gloas keeps it on the bid (UintBn64 → cast), pre-gloas on the header
    let parentGasLimit: number;
    if (isStatePostGloas(state)) {
      parentBlockHash = isBuildingOnFull
        ? state.latestExecutionPayloadBid.blockHash
        : state.latestExecutionPayloadBid.parentBlockHash;
      parentGasLimit = Number(state.latestExecutionPayloadBid.gasLimit);
    } else if (isStatePostBellatrix(state)) {
      parentBlockHash = state.latestExecutionPayloadHeader.blockHash;
      parentGasLimit = state.latestExecutionPayloadHeader.gasLimit;
    } else {
      parentBlockHash = ZERO_HASH; // pre-bellatrix: unused
      parentGasLimit = 0;
    }

    // Apply the parent execution payload ONCE here (gloas, building-on-full) so the common body and the
    // payload-attribute withdrawals are produced from the exact state the block transitions through.
    // `getParentExecutionRequests` is only called when `isBuildingOnFull` (parent is FULL in forkChoice →
    // its envelope is available); on build-on-empty the base state is used. Both production paths
    // (self-build / builder-bid) agree because the builder-bid lookup is gated by `isBuildingOnFull`.
    let parentExecutionRequests = ssz.gloas.ExecutionRequests.defaultValue();
    let stateForProduction: IBeaconStateView = state;
    if (isBuildingOnFull && isStatePostGloas(state)) {
      parentExecutionRequests = await this.getParentExecutionRequests(parentBlock.slot, parentBlock.blockRoot);
      stateForProduction = state.withParentPayloadApplied(parentExecutionRequests);
    }

    // Payload attributes, resolved once from the production state. `prevRandao` (above) is unaffected by
    // the parent payload, so it is reused for both the EL request and the gloas self-bid. gloas
    // withdrawals: building-on-full → applied-state `getExpectedWithdrawals`; build-on-empty →
    // `payloadExpectedWithdrawals` (a batch already deducted from CL balances but never delivered on the
    // EL, which the next payload must carry to keep CL/EL consistent).
    const timestamp = computeTimeAtSlot(this.config, state.slot, state.genesisTime);
    let withdrawals: PayloadAttributesWithdrawals | undefined;
    if (isStatePostGloas(stateForProduction)) {
      withdrawals = isBuildingOnFull
        ? stateForProduction.getExpectedWithdrawals().expectedWithdrawals
        : stateForProduction.payloadExpectedWithdrawals;
    } else if (isStatePostCapella(stateForProduction)) {
      withdrawals = stateForProduction.getExpectedWithdrawals().expectedWithdrawals;
    }

    // gloas: resolve the proposer target gas limit here (engine-owned fork choice / proposer-preferences
    // pool) so the facade self-build path passes it to `prepareExecutionPayload` as plain data.
    const targetGasLimit = isForkPostGloas(fork)
      ? this.getProposerTargetGasLimit(slot, fromHex(parentBlock.blockRoot), parentBlockHash)
      : undefined;

    // Build the common body from `stateForProduction` (its voluntaryExits / blsToExecutionChanges are
    // already valid against the applied state — no per-path re-filter downstream). Deferred to the next
    // event loop so the downstream EL request goes out first.
    const commonBlockBodyPromise = new Promise<CommonBlockBody>((resolve, reject) => {
      callInNextEventLoop(() => {
        try {
          resolve(
            this.assembleCommonBlockBody(BlockType.Full, stateForProduction, {
              slot,
              parentBlock,
              randaoReveal,
              graffiti,
            })
          );
        } catch (e) {
          reject(e as Error);
        }
      });
    });

    return {
      parentBlock,
      proposerIndex,
      proposerPubKey,
      defaultFeeRecipient,
      feeRecipientCached,
      safeBlockHash,
      finalizedBlockHash,
      timestamp,
      prevRandao,
      parentBlockHash,
      parentGasLimit,
      isBuildingOnFull,
      builderBid,
      parentExecutionRequests,
      payloadAttestations,
      withdrawals,
      targetGasLimit,
      commonBlockBodyPromise,
    };
  }

  /**
   * Produce the fork-agnostic part of a block body (attestations, slashings, exits, sync aggregate).
   * Fetches the block-slot state internally; the result is reused across the self-build and builder-bid
   * production paths.
   */
  async produceCommonBlockBody(blockAttributes: BlockAttributes): Promise<CommonBlockBody> {
    const {slot, parentBlock} = blockAttributes;
    const state = await this.regen.getBlockSlotState(
      parentBlock,
      slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );
    return this.assembleCommonBlockBody(BlockType.Full, state, blockAttributes);
  }

  /**
   * Compute the post-state root (and proposer reward) for a produced block. Resolves the parent
   * `ProtoBlock` from `block.parentRoot` and regens the block-slot state internally (cache hit after
   * `produceBlockBase`), so the facade passes no `BeaconState`. The JS engine uses the `block` POJO and
   * ignores `_blockBytes` / `_blinded` (these feed the native engine's bytes-first deserialize).
   */
  async computeNewStateRoot(
    block: BeaconBlock | BlindedBeaconBlock,
    _blockBytes: Uint8Array,
    _blinded: boolean
  ): Promise<{newStateRoot: Root; proposerReward: Gwei}> {
    const parentBlock = this.forkChoice.getBlockDefaultStatus(block.parentRoot);
    if (parentBlock === null) {
      throw Error(`Parent block not found for computeNewStateRoot root=${toRootHex(block.parentRoot)}`);
    }
    const state = await this.regen.getBlockSlotState(
      parentBlock,
      block.slot,
      {dontTransferCache: true},
      RegenCaller.produceBlock
    );
    const {newStateRoot, proposerReward} = computeNewStateRoot(this.metrics, state, block);
    return {newStateRoot, proposerReward};
  }

  /**
   * Advance preparation for the next slot. Does all consensus work internally (recompute head, regen the
   * prepare-state, predict a proposer-boost-reorg, precompute the epoch transition, cache `hashTreeRoot`)
   * and returns the side-effects the facade must perform (EL advance-prep + builder, DA prune, SSE emit).
   * The sleep timing and try/catch error reporting stay in the facade scheduler. Returns `null` when
   * there is nothing for the facade to do.
   */
  async prepareForNextSlot(clockSlot: Slot): Promise<PrepareNextSlotResult | null> {
    const prepareSlot = clockSlot + 1;
    const nextEpoch = computeEpochAtSlot(clockSlot) + 1;
    const isEpochTransition = computeEpochAtSlot(prepareSlot) === nextEpoch;
    const fork = this.config.getForkName(prepareSlot);

    // calling updateHead() here before we produce a block to reduce reorg possibility
    const headBlock = this.recomputeForkChoiceHead();
    const {slot: headSlot, blockRoot: headRoot} = headBlock;
    // may be updated below if we predict a proposer-boost-reorg
    let updatedHead = headBlock;

    // PS: previously this was comparing slots, but that gave no leway on the skipped
    // slots on epoch bounday. Making it more fluid.
    if (prepareSlot - headSlot > PREPARE_EPOCH_LIMIT * SLOTS_PER_EPOCH) {
      this.metrics?.precomputeNextEpochTransition.count.inc({result: "skip"}, 1);
      this.logger.debug("Skipping PrepareNextSlotScheduler - head slot is too behind current slot", {
        nextEpoch,
        headSlot,
        clockSlot,
      });
      return null;
    }

    this.logger.verbose("Running prepareForNextSlot", {nextEpoch, prepareSlot, headSlot, headRoot, isEpochTransition});
    const precomputeEpochTransitionTimer = isEpochTransition
      ? this.metrics?.precomputeNextEpochTransition.duration.startTimer()
      : null;
    const start = Date.now();
    // No need to wait for this or the clock drift
    // Pre Bellatrix: we only do precompute state transition for the last slot of epoch
    // For Bellatrix, we always do the `processSlots()` to prepare payload for the next slot
    const prepareState = await this.regen.getBlockSlotState(
      headBlock,
      prepareSlot,
      // the slot 0 of next epoch will likely use this Previous Root Checkpoint state for state transition so we transfer cache here
      // the resulting state with cache will be cached in Checkpoint State Cache which is used for the upcoming block processing
      // for other slots dontTransferCached=true because we don't run state transition on this state
      {dontTransferCache: !isEpochTransition},
      RegenCaller.precomputeEpoch
    );

    let elPrep: PrepareNextSlotResult["elPrep"] = null;
    let daPruneParent: ProtoBlock | null = null;
    let sse: PrepareNextSlotResult["sse"] = null;

    if (isForkPostBellatrix(fork)) {
      const proposerIndex = prepareState.getBeaconProposer(prepareSlot);
      // set iff WE propose next slot — gates builder status / EL prep, exactly as before
      const feeRecipient = this.beaconProposerCache.get(proposerIndex);
      let updatedPrepareState = prepareState;

      if (feeRecipient) {
        // If we are proposing next slot, we need to predict if we can proposer-boost-reorg or not
        const proposerHead = this.predictProposerHead(clockSlot);
        const {slot: proposerHeadSlot, blockRoot: proposerHeadRoot} = proposerHead;

        // If we predict we can reorg, update prepareState with proposer head block
        if (proposerHeadRoot !== headRoot || proposerHeadSlot !== headSlot) {
          this.logger.verbose("Weak head detected. May build on parent block instead", {
            proposerHeadSlot,
            proposerHeadRoot,
            headSlot,
            headRoot,
          });
          this.metrics?.weakHeadDetected.inc();
          updatedPrepareState = await this.regen.getBlockSlotState(
            proposerHead,
            prepareSlot,
            // only transfer cache if epoch transition because that's the state we will use to stateTransition() the 1st block of epoch
            {dontTransferCache: !isEpochTransition},
            RegenCaller.predictProposerHead
          );
          updatedHead = proposerHead;
        }
      }

      if (!isStatePostBellatrix(updatedPrepareState)) {
        throw new Error("Expected Bellatrix state for payload attributes");
      }

      let parentBlockHash: Bytes32;
      // Apply parent payload once here as it's reused by EL prep and SSE emit below
      let stateAfterParentPayload: IBeaconStateViewBellatrix = updatedPrepareState;
      if (isStatePostGloas(updatedPrepareState)) {
        // Spec: should_build_on_full(store, head) — see produceBlockBody.ts for context.
        if (this.forkChoice.shouldBuildOnFull(updatedHead, prepareSlot)) {
          parentBlockHash = updatedPrepareState.latestExecutionPayloadBid.blockHash;
          // Skip applying parent payload unless we're proposing the next slot or have to emit payload_attributes events
          if (feeRecipient !== undefined || this.opts.emitPayloadAttributes === true) {
            const parentExecutionRequests = await this.getParentExecutionRequests(
              updatedHead.slot,
              updatedHead.blockRoot
            );
            stateAfterParentPayload = updatedPrepareState.withParentPayloadApplied(parentExecutionRequests);
          }
        } else {
          parentBlockHash = updatedPrepareState.latestExecutionPayloadBid.parentBlockHash;
        }
      } else {
        parentBlockHash = updatedPrepareState.latestExecutionPayloadHeader.blockHash;
      }

      // EL advance-prep inputs — ONLY when WE propose next slot. Facade does builder status + EL.
      if (feeRecipient) {
        const parentBlockRoot = fromHex(updatedHead.blockRoot);
        const preparationTime =
          computeTimeAtSlot(this.config, prepareSlot, prepareState.genesisTime) - Date.now() / 1000;
        this.metrics?.blockPayload.payloadAdvancePrepTime.observe(preparationTime);
        elPrep = {
          fork: fork as ForkPostBellatrix,
          proposerIndex,
          feeRecipient,
          parentBlockRoot,
          parentBlockHash,
          safeBlockHash: getSafeExecutionBlockHash(this.forkChoice),
          finalizedBlockHash: this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX,
          prepareSlot,
          payloadAttributesInput: this.resolvePayloadAttributesInput(
            fork as ForkPostBellatrix,
            stateAfterParentPayload,
            parentBlockHash
          ),
          // the only engine-owned value the facade EL path needs (gloas); resolved here so the facade
          // `prepareExecutionPayload` stays off fork choice / the proposer-preferences pool
          targetGasLimit:
            ForkSeq[fork] >= ForkSeq.gloas
              ? this.getProposerTargetGasLimit(prepareSlot, parentBlockRoot, parentBlockHash)
              : undefined,
        };
      }

      if (ForkSeq[fork] >= ForkSeq.gloas) {
        // Cutoff = slot of the parent of the block we'll actually build on (post-reorg).
        // Steady state: cache holds just 2 entries — head (parent for next-slot production)
        // and head.parent (proposer-boost-reorg fallback). Anything older is evicted.
        daPruneParent = this.forkChoice.getBlockHexDefaultStatus(updatedHead.parentRoot) ?? null;
      }

      this.computeStateHashTreeRoot(updatedPrepareState, isEpochTransition);

      // If emitPayloadAttributes is true emit a SSE payloadAttributes event for
      // every slot. Without the flag, only emit the event if we are proposing in the next slot.
      if (
        (feeRecipient || this.opts.emitPayloadAttributes === true) &&
        this.emitter.listenerCount(routes.events.EventType.payloadAttributes)
      ) {
        const data = this.getPayloadAttributesForSSE(fork as ForkPostBellatrix, {
          prepareSlot,
          parentBlockRoot: fromHex(updatedHead.blockRoot),
          parentBlockHash,
          feeRecipient: feeRecipient ?? "0x0000000000000000000000000000000000000000",
          proposerIndex: stateAfterParentPayload.getBeaconProposer(prepareSlot),
          parentBlockNumberPreGloas:
            ForkSeq[fork] >= ForkSeq.gloas ? undefined : stateAfterParentPayload.payloadBlockNumber,
          ...this.resolvePayloadAttributesInput(fork as ForkPostBellatrix, stateAfterParentPayload, parentBlockHash),
        });
        sse = {data, version: fork};
      }
    } else {
      this.computeStateHashTreeRoot(prepareState, isEpochTransition);
    }

    // assuming there is no reorg, it caches the checkpoint state & helps avoid doing a full state transition in the next slot
    //  + when gossip block comes, we need to validate and run state transition
    //  + if next slot is a skipped slot, it'd help getting target checkpoint state faster to validate attestations
    if (isEpochTransition) {
      this.metrics?.precomputeNextEpochTransition.count.inc({result: "success"}, 1);
      const previousHits = this.regen.updatePreComputedCheckpoint(headRoot, nextEpoch);
      if (previousHits === 0) {
        this.metrics?.precomputeNextEpochTransition.waste.inc();
      }
      this.metrics?.precomputeNextEpochTransition.hits.set(previousHits ?? 0);

      this.logger.verbose("Completed PrepareNextSlotScheduler epoch transition", {
        nextEpoch,
        headSlot,
        prepareSlot,
        previousHits,
        durationMs: Date.now() - start,
      });

      precomputeEpochTransitionTimer?.();
    }

    return elPrep || daPruneParent || sse ? {elPrep, daPruneParent, sse} : null;
  }

  /** Canonical head recompute used before block production (mirrors chain.ts facade method). */
  private recomputeForkChoiceHead(): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: ForkchoiceCaller.prepareNextSlot});
    try {
      return this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetCanonicalHead}).head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetCanonicalHead});
      throw e;
    } finally {
      timer?.();
    }
  }

  /** Predicted proposer head for proposer-boost-reorg (mirrors chain.ts facade method). */
  private predictProposerHead(slot: Slot): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: FindHeadFnName.predictProposerHead});
    const secFromSlot = this.clock.secFromSlot(slot);
    try {
      return this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetPredictedProposerHead, secFromSlot, slot}).head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetPredictedProposerHead});
      throw e;
    } finally {
      timer?.();
    }
  }

  /**
   * Cache HashObjects for faster hashTreeRoot() later, especially for computeNewStateRoot() if we need to
   * produce a block at slot 0 of epoch. See https://github.com/ChainSafe/lodestar/issues/6194
   */
  private computeStateHashTreeRoot(state: IBeaconStateView, isEpochTransition: boolean): void {
    const hashTreeRootTimer = this.metrics?.stateHashTreeRootTime.startTimer({
      source: isEpochTransition ? StateHashTreeRootSource.prepareNextEpoch : StateHashTreeRootSource.prepareNextSlot,
    });
    state.hashTreeRoot();
    hashTreeRootTimer?.();
  }

  /**
   * The single place that reads `BeaconState` for execution payload attributes. Everything downstream
   * consumes the returned plain fields and never touches the state.
   *
   * Post-gloas, when extending a full parent, callers must apply parent execution payload first
   * (see `withParentPayloadApplied`) before calling this.
   */
  private resolvePayloadAttributesInput(
    fork: ForkPostBellatrix,
    state: IBeaconStateViewBellatrix,
    parentBlockHash: Bytes32
  ): PayloadAttributesInput {
    const timestamp = computeTimeAtSlot(this.config, state.slot, state.genesisTime);
    const prevRandao = state.getRandaoMix(state.epoch);

    let withdrawals: PayloadAttributesWithdrawals | undefined;
    if (ForkSeq[fork] >= ForkSeq.capella) {
      if (!isStatePostCapella(state)) {
        throw new Error("Expected Capella state for withdrawals");
      }

      if (isStatePostGloas(state)) {
        const isExtendingPayload = byteArrayEquals(parentBlockHash, state.latestExecutionPayloadBid.blockHash);
        if (isExtendingPayload) {
          // applyParentExecutionPayload sets latestBlockHash = parentBid.blockHash, so a mismatch
          // here means the caller did not apply parent payload to state
          if (!byteArrayEquals(state.latestBlockHash, state.latestExecutionPayloadBid.blockHash)) {
            throw new Error("Expected state with parent execution payload applied for withdrawals");
          }
          withdrawals = state.getExpectedWithdrawals().expectedWithdrawals;
        } else {
          // When the parent block is empty, state.payloadExpectedWithdrawals holds a batch
          // already deducted from CL balances but never credited on the EL (the envelope
          // was not delivered). The next payload must carry those same withdrawals to
          // restore CL/EL consistency, otherwise validators permanently lose that balance.
          withdrawals = state.payloadExpectedWithdrawals;
        }
      } else {
        // withdrawals logic is now fork aware as it changes on electra fork post capella
        withdrawals = state.getExpectedWithdrawals().expectedWithdrawals;
      }
    }

    return {timestamp, prevRandao, withdrawals};
  }

  /**
   * Build the SSE `payloadAttributes` event payload for the prepare slot. Reads engine-owned fork choice
   * (parent block number) and resolves the gloas `targetGasLimit` internally.
   */
  private getPayloadAttributesForSSE(
    fork: ForkPostBellatrix,
    {
      prepareSlot,
      parentBlockRoot,
      parentBlockHash,
      feeRecipient,
      timestamp,
      prevRandao,
      withdrawals,
      proposerIndex,
      parentBlockNumberPreGloas,
    }: {
      prepareSlot: Slot;
      parentBlockRoot: Root;
      parentBlockHash: Bytes32;
      feeRecipient: string;
      /** proposer at the prepare slot (SSE event) */
      proposerIndex: ValidatorIndex;
      /** pre-gloas only: `state.payloadBlockNumber` for the SSE parentBlockNumber */
      parentBlockNumberPreGloas?: number;
    } & PayloadAttributesInput
  ): SSEPayloadAttributes {
    const targetGasLimit = isForkPostGloas(fork)
      ? this.getProposerTargetGasLimit(prepareSlot, parentBlockRoot, parentBlockHash)
      : undefined;
    const payloadAttributes = preparePayloadAttributes(fork, targetGasLimit, {
      prepareSlot,
      parentBlockRoot,
      feeRecipient,
      timestamp,
      prevRandao,
      withdrawals,
    });

    let parentBlockNumber: number;
    if (isForkPostGloas(fork)) {
      const parentBlock = this.forkChoice.getBlockHexAndBlockHash(
        toRootHex(parentBlockRoot),
        toRootHex(parentBlockHash)
      );
      if (parentBlock?.executionPayloadBlockHash == null) {
        throw Error(`Parent block not found in fork choice root=${toRootHex(parentBlockRoot)}`);
      }
      parentBlockNumber = parentBlock.executionPayloadNumber;
    } else {
      if (parentBlockNumberPreGloas === undefined) {
        throw Error("Expected parentBlockNumberPreGloas for pre-gloas SSE payload attributes");
      }
      parentBlockNumber = parentBlockNumberPreGloas;
    }

    return {
      proposerIndex,
      proposalSlot: prepareSlot,
      parentBlockNumber,
      parentBlockRoot,
      parentBlockHash,
      payloadAttributes,
    };
  }

  /**
   * Resolve the proposer's preferred (target) gas limit for the Gloas `PayloadAttributesV4`
   * `targetGasLimit` field (consensus-specs#5235, execution-apis#796).
   *
   * Sourced from the `SignedProposerPreferences` the proposer's VC submitted to the pool
   * (same `(slot, dependent_root)` lookup as gossip bid validation). When no matching
   * preferences are pooled, target the parent payload's gas limit so the gas limit stays
   * unchanged (`is_gas_limit_target_compatible` then requires `gas_limit == parent_gas_limit`).
   *
   * The parent payload's gas_limit is read from fork choice — the variant matching
   * `(parentBlockRoot, parentBlockHash)` carries the correct value for both FULL parents
   * (FULL.executionPayloadGasLimit = delivered payload's gas_limit) and EMPTY parents
   * (EMPTY.executionPayloadGasLimit = inherited grandparent's gas_limit).
   */
  private getProposerTargetGasLimit(prepareSlot: Slot, parentBlockRoot: Root, parentBlockHash: Bytes32): number {
    const parentBlockRootHex = toRootHex(parentBlockRoot);
    const parentBlock = this.forkChoice.getBlockHexDefaultStatus(parentBlockRootHex);
    const dependentRootHex = (() => {
      if (parentBlock === null) {
        return null;
      }
      try {
        return getShufflingDependentRoot(
          this.forkChoice,
          computeEpochAtSlot(prepareSlot),
          computeEpochAtSlot(parentBlock.slot),
          parentBlock
        );
      } catch {
        return null;
      }
    })();

    const pref = dependentRootHex !== null ? this.proposerPreferencesPool.get(prepareSlot, dependentRootHex) : null;
    if (pref !== null) {
      return pref.message.targetGasLimit;
    }

    const parentPayloadVariant = this.forkChoice.getBlockHexAndBlockHash(
      parentBlockRootHex,
      toRootHex(parentBlockHash)
    );
    if (parentPayloadVariant === null || parentPayloadVariant.executionPayloadBlockHash === null) {
      throw new Error(
        `Cannot resolve parent payload gas_limit for proposer targetGasLimit fallback parentBlockRoot=${parentBlockRootHex} parentBlockHash=${toRootHex(parentBlockHash)}`
      );
    }
    return parentPayloadVariant.executionPayloadGasLimit;
  }

  /**
   * Proposer duties for `epoch`.
   */
  async getProposerDuties(
    epoch: Epoch,
    {currentEpoch, checkpointWaitTimeoutMs}: {currentEpoch: Epoch; checkpointWaitTimeoutMs?: number},
    v2: boolean
  ): Promise<{data: routes.validator.ProposerDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    const startSlot = computeStartSlotAtEpoch(epoch);
    const head = this.forkChoice.getHead();

    let state: IBeaconStateView | undefined;
    if (checkpointWaitTimeoutMs !== undefined) {
      const cpState = await this.waitForCheckpointState(
        {rootHex: head.blockRoot, epoch: currentEpoch + 1},
        checkpointWaitTimeoutMs
      );
      if (cpState) {
        state = cpState;
        this.metrics?.duties.requestNextEpochProposalDutiesHit.inc();
      } else {
        this.metrics?.duties.requestNextEpochProposalDutiesMiss.inc();
      }
    }
    if (!state) {
      if (epoch >= currentEpoch - 1) {
        // TODO - beacon engine: not sure if we need to do this, just conform to the current unstable behavior for now
        state = await this.getHeadStateAtEpoch(currentEpoch, RegenCaller.getDuties);
      } else {
        // TODO - beacon engine: currently unstable call getStateResponseWithRegen()
        // the engine (Phase 5). Throw for now; serve it here once the engine owns the archive.
        throw Error(`Proposer duties for past epoch ${epoch} not supported yet (engine has no archive access)`);
      }
    }

    const stateEpoch = state.epoch;
    let indexes: ValidatorIndex[];
    switch (epoch) {
      case stateEpoch:
        indexes = state.currentProposers;
        break;

      case stateEpoch + 1:
        // make sure shuffling is calculated and ready for the call to calculate nextProposers
        await this.shufflingCache.get(stateEpoch + 1, state.nextDecisionRoot);
        indexes = state.nextProposers;
        break;

      case stateEpoch - 1: {
        const indexesPrevEpoch = state.previousProposers;
        if (indexesPrevEpoch === null) {
          // Should not happen as previous proposer duties should be initialized for head state
          throw Error(`Proposer duties for previous epoch ${epoch} not yet initialized`);
        }
        indexes = indexesPrevEpoch;
        break;
      }

      default:
        throw Error(`Proposer duties for epoch ${epoch} not supported, current epoch ${stateEpoch}`);
    }

    const pubkeys = getPubkeysForIndices(state, indexes);
    const data: routes.validator.ProposerDuty[] = [];
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      data.push({slot: startSlot + i, validatorIndex: indexes[i], pubkey: pubkeys[i]});
    }

    // In v2 the dependent root is different after fulu due to deterministic proposer lookahead
    let dependentRoot = proposerShufflingDecisionRoot(
      v2 ? this.config.getForkName(startSlot) : ForkName.phase0,
      state,
      epoch
    );
    const logCtx = {epoch, stateSlot: state.slot, stateEpoch, v2};
    if (dependentRoot === null) {
      // fallback to get_proposer_duties() v1, also in lodestar v1.43
      this.logger.verbose("Proposer duties decision root not in state, falling back to state epoch", logCtx);
      dependentRoot = proposerShufflingDecisionRoot(ForkName.phase0, state, stateEpoch);
    }
    if (dependentRoot === null) {
      this.logger.verbose("Proposer duties decision root not in state, falling back to genesis block root", logCtx);
      dependentRoot = this.genesisBlockRoot(state);
    }
    this.logger.verbose("Computed proposer duties decision root", {...logCtx, dependentRoot: toRootHex(dependentRoot)});

    return {data, dependentRoot, head};
  }

  /** Attester duties for `validatorIndices` at `epoch`. State resolved at `currentEpoch` (passed-in clock). */
  async getAttesterDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.AttesterDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    const head = this.forkChoice.getHead();
    const state = await this.getHeadStateAtEpoch(currentEpoch, RegenCaller.getDuties);

    // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
    const pubkeys = getPubkeysForIndices(state, indices);
    const decisionRoot = state.getShufflingDecisionRoot(epoch);
    const shuffling = await this.shufflingCache.get(epoch, decisionRoot);
    if (!shuffling) {
      throw Error(
        `No shuffling found to calculate committee assignments for epoch: ${epoch} and decisionRoot: ${decisionRoot}`
      );
    }
    const committeeAssignments = calculateCommitteeAssignments(shuffling, indices);
    const data: routes.validator.AttesterDuty[] = [];
    for (let i = 0, len = indices.length; i < len; i++) {
      const validatorIndex = indices[i];
      const duty = committeeAssignments.get(validatorIndex) as routes.validator.AttesterDuty | undefined;
      if (duty) {
        // Mutate existing object instead of re-creating another new object with spread operator
        // Should be faster and require less memory
        duty.pubkey = pubkeys[i];
        data.push(duty);
      }
    }

    const dependentRoot = fromHex(state.getShufflingDecisionRoot(epoch)) || this.genesisBlockRoot(state);
    return {data, dependentRoot, head};
  }

  /** Sync committee duties for `validatorIndices` at `epoch`. Synchronous — served from head state. */
  getSyncCommitteeDuties(
    epoch: Epoch,
    indices: ValidatorIndex[]
  ): {data: routes.validator.SyncDuty[]; head: ProtoBlock} {
    const head = this.forkChoice.getHead();
    const state = this.getHeadState();
    if (!isStatePostAltair(state)) {
      throw Error("Sync committee duties are not available before Altair");
    }

    // Check that all validatorIndex belong to the state before calling getCommitteeAssignments()
    const pubkeys = getPubkeysForIndices(state, indices);
    // Ensures `epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD <= current_epoch // EPOCHS_PER_SYNC_COMMITTEE_PERIOD + 1`
    const validatorSyncCommitteeIndexMap = state.getIndexedSyncCommitteeAtEpoch(epoch).validatorIndexMap;

    const data: routes.validator.SyncDuty[] = [];
    for (let i = 0, len = indices.length; i < len; i++) {
      const validatorIndex = indices[i];
      const validatorSyncCommitteeIndices = validatorSyncCommitteeIndexMap.get(validatorIndex);
      if (validatorSyncCommitteeIndices) {
        data.push({pubkey: pubkeys[i], validatorIndex, validatorSyncCommitteeIndices});
      }
    }

    return {data, head};
  }

  /** gloas: PTC duties for `validatorIndices` at `epoch`. State resolved at `currentEpoch` (passed-in clock). */
  async getPtcDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.PtcDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    const startSlot = computeStartSlotAtEpoch(epoch);
    const head = this.forkChoice.getHead();
    const state = await this.getHeadStateAtEpoch(currentEpoch, RegenCaller.getDuties);
    if (!isStatePostGloas(state)) {
      throw Error("PTC duties are not available before Gloas");
    }

    const pubkeys = getPubkeysForIndices(state, indices);
    const ptcs = state.getEpochPTCs(epoch);
    const data: routes.validator.PtcDuty[] = [];
    for (let i = 0, len = indices.length; i < len; i++) {
      const validatorIndex = indices[i];
      for (let j = 0; j < SLOTS_PER_EPOCH; j++) {
        if (ptcs[j].indexOf(validatorIndex) !== -1) {
          data.push({pubkey: pubkeys[i], validatorIndex, slot: j + startSlot});
          break;
        }
      }
    }

    const dependentRoot = fromHex(state.getShufflingDecisionRoot(epoch)) || this.genesisBlockRoot(state);
    return {data, dependentRoot, head};
  }

  /**
   * Head state advanced to `epoch` (mirrors the former `chain.getHeadStateAtEpoch`; keeps `RegenCaller.getDuties`).
   * No clock: the caller passes the target epoch.
   */
  private async getHeadStateAtEpoch(epoch: Epoch, regenCaller: RegenCaller): Promise<IBeaconStateView> {
    // using getHeadState() means we'll use checkpointStateCache if it's available
    const headState = this.getHeadState();
    // head state is in the same epoch, or we pulled up head state already from past epoch
    if (epoch <= computeEpochAtSlot(headState.slot)) {
      // should go to this most of the time
      return headState;
    }
    // only use regen queue if necessary, it'll cache in checkpointStateCache if regen gets through epoch transition
    const head = this.forkChoice.getHead();
    const startSlot = computeStartSlotAtEpoch(epoch);
    return this.regen.getBlockSlotState(head, startSlot, {dontTransferCache: true}, regenCaller);
  }

  /**
   * Wait briefly for the next-epoch checkpoint state to be computed by the prepare-next-slot scheduler so
   * the upcoming epoch's proposer duties can be served slightly early. Regen-centric; clock-free — the
   * `clock.waitForSlot` deadline is passed in as a relative `timeoutMs` (a plain timer, not a slot-clock).
   */
  private async waitForCheckpointState(cpHex: CheckpointHex, timeoutMs: number): Promise<IBeaconStateView | null> {
    const cpState = this.regen.getCheckpointStateSync(cpHex);
    if (cpState) {
      return cpState;
    }
    const cp = {epoch: cpHex.epoch, root: fromHex(cpHex.rootHex)};
    // if not, wait for ChainEvent.checkpoint event until the relative timeout elapses
    let listener: ((eventCp: phase0.Checkpoint) => void) | null = null;
    const foundCPState = await Promise.race([
      new Promise((resolve) => {
        listener = (eventCp) => {
          resolve(ssz.phase0.Checkpoint.equals(eventCp, cp));
        };
        this.emitter.once(ChainEvent.checkpoint, listener);
      }),
      sleep(timeoutMs),
    ]);

    if (listener != null) {
      this.emitter.off(ChainEvent.checkpoint, listener);
    }

    if (foundCPState === true) {
      return this.regen.getCheckpointStateSync(cpHex);
    }

    return null;
  }

  /**
   * Compute and cache the genesis block root from internal state (genesis-shuffling duty fallback).
   * Drops the former DB-block read; near genesis the state-derived root is authoritative, and if it is
   * ever unavailable returning ZERO_HASH at worst triggers a duties re-fetch.
   */
  private genesisBlockRoot(state: IBeaconStateView): Root {
    if (!this.cachedGenesisBlockRoot) {
      // Close to genesis the genesis block may not be available in the DB
      if (state.slot === GENESIS_SLOT) {
        this.cachedGenesisBlockRoot = state.computeAnchorCheckpoint().checkpoint.root;
      } else if (state.slot < SLOTS_PER_HISTORICAL_ROOT) {
        this.cachedGenesisBlockRoot = state.getBlockRootAtSlot(GENESIS_SLOT);
      }
    }
    return this.cachedGenesisBlockRoot || ZERO_HASH;
  }

  private assembleCommonBlockBody(
    blockType: BlockType,
    currentState: IBeaconStateView,
    {randaoReveal, graffiti, slot, parentBlock}: BlockAttributes
  ): CommonBlockBody {
    const stepsMetrics =
      blockType === BlockType.Full
        ? this.metrics?.executionBlockProductionTimeSteps
        : this.metrics?.builderBlockProductionTimeSteps;

    const fork = this.config.getForkName(slot);

    const [attesterSlashings, proposerSlashings, voluntaryExits, blsToExecutionChanges] =
      this.opPool.getSlashingsAndExits(currentState, blockType, this.metrics);

    const endAttestations = stepsMetrics?.startTimer();
    const attestations = this.aggregatedAttestationPool.getAttestationsForBlock(
      fork,
      this.forkChoice,
      this.shufflingCache,
      currentState
    );
    endAttestations?.({step: BlockProductionStep.attestations});

    const blockBody: Omit<CommonBlockBody, "blsToExecutionChanges" | "syncAggregate"> = {
      randaoReveal,
      graffiti,
      // Eth1 data voting is no longer required since electra
      eth1Data: currentState.eth1Data,
      proposerSlashings,
      attesterSlashings,
      attestations,
      // Since electra, deposits are processed by the execution layer,
      // we no longer support handling deposits from earlier forks.
      deposits: [],
      voluntaryExits,
    };

    if (ForkSeq[fork] >= ForkSeq.capella) {
      (blockBody as CommonBlockBody).blsToExecutionChanges = blsToExecutionChanges;
    }

    const endSyncAggregate = stepsMetrics?.startTimer();
    if (ForkSeq[fork] >= ForkSeq.altair) {
      const parentBlockRoot = fromHex(parentBlock.blockRoot);
      const previousSlot = slot - 1;
      const syncAggregate = this.syncContributionAndProofPool.getAggregate(previousSlot, parentBlockRoot);
      this.metrics?.production.producedSyncAggregateParticipants.observe(
        syncAggregate.syncCommitteeBits.getTrueBitIndexes().length
      );
      (blockBody as CommonBlockBody).syncAggregate = syncAggregate;
    }
    endSyncAggregate?.({step: BlockProductionStep.syncAggregate});

    return blockBody as CommonBlockBody;
  }

  // Gossip validation flows. Each method takes the message's SSZ bytes first (unused by this JS impl;
  // present for the native engine's bytes-first contract) and delegates to the validation logic in
  // `../validation/*` rebound onto the engine.
  validateGossipBlock(
    _blockBytes: Uint8Array,
    signedBlock: SignedBeaconBlock,
    fork: ForkName
  ): Promise<GossipValidationResult<GossipBlockValidationResult>> {
    return runGossipValidation(() => validateGossipBlock.call(this, signedBlock, fork));
  }

  validateGossipSyncCommittee(
    _syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      const result = await validateGossipSyncCommittee.call(this, syncCommittee, subnet);
      // Insert for ALL positions this validator holds in the subcommittee (moved from the gossip handler).
      // The subcommittee indices are consumed here internally; the facade only needs the verdict.
      try {
        for (const indexInSubcommittee of result.indicesInSubcommittee) {
          const insertOutcome = this.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee);
          this.metrics?.opPool.syncCommitteeMessagePoolInsertOutcome.inc({insertOutcome});
        }
      } catch (e) {
        this.logger.debug("Error adding to syncCommittee pool", {subnet}, e as Error);
      }
    });
  }

  // Returns the subnets to broadcast to (the facade publishes). Resolves committee membership + pool insert
  // internally so the facade never touches state or the pool for API sync-committee submission.
  validateApiSyncCommittee(
    _syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>> {
    return runGossipValidation(async () => {
      const state = this.getHeadState();
      // The node's own validators — skip silently if this validator isn't in the sync committee.
      const indexesInCommittee = isStatePostAltair(state)
        ? state.getIndexedSyncCommittee(syncCommittee.slot).validatorIndexMap.get(syncCommittee.validatorIndex)
        : undefined;
      if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
        return {subnets: []};
      }
      // Verify signature only, all other data is very likely correct since this node produced the signature.
      await validateApiSyncCommittee.call(this, syncCommittee);
      // The same validator can appear multiple times in the committee (and per subnet). Insert each position
      // (priority: allow late API messages into the pool) and collect the subnets for the facade to publish.
      const subnets: number[] = [];
      for (const indexInCommittee of indexesInCommittee) {
        const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
        const indexInSubcommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
        this.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee, true);
        if (subnets.length === 0 || subnets.at(-1) !== subnet) {
          subnets.push(subnet);
        }
      }
      return {subnets};
    });
  }

  validateSyncCommitteeGossipContributionAndProof(
    _contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants = false
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
    return runGossipValidation(async () => {
      const result = await validateSyncCommitteeGossipContributionAndProof.call(
        this,
        signedContributionAndProof,
        skipValidationKnownParticipants
      );
      // Insert into the pool on Accept (moved from the gossip handler).
      this.insertSyncContributionOnAccept(
        signedContributionAndProof,
        result.syncCommitteeParticipantIndices.length,
        "gossip"
      );
      return result;
    });
  }

  validateApiSyncCommitteeContributionAndProof(
    _contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      // API path skips the known-participants check (the signature object is produced by this node).
      const result = await validateSyncCommitteeGossipContributionAndProof.call(this, signedContributionAndProof, true);
      // Insert into the pool on Accept (moved from the API handler); the facade only needs the verdict.
      this.insertSyncContributionOnAccept(
        signedContributionAndProof,
        result.syncCommitteeParticipantIndices.length,
        "api"
      );
    });
  }

  /** Shared post-validation pool insert for a valid sync contribution (gossip swallows errors; API does not). */
  private insertSyncContributionOnAccept(
    signed: altair.SignedContributionAndProof,
    syncCommitteeParticipants: number,
    source: "gossip" | "api"
  ): void {
    const metric = this.metrics?.opPool.syncContributionAndProofPool;
    if (source === "gossip") {
      try {
        const insertOutcome = this.syncContributionAndProofPool.add(signed.message, syncCommitteeParticipants);
        metric?.gossipInsertOutcome.inc({insertOutcome});
      } catch (e) {
        this.logger.error("Error adding to contributionAndProof pool", {}, e as Error);
      }
    } else {
      // API allows late messages into the pool (priority) and surfaces a pool error as a submit failure.
      const insertOutcome = this.syncContributionAndProofPool.add(signed.message, syncCommitteeParticipants, true);
      metric?.apiInsertOutcome.inc({insertOutcome});
    }
  }

  validateGossipBlobSidecar(
    _blobBytes: Uint8Array,
    fork: ForkName,
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() => validateGossipBlobSidecar.call(this, fork, blobSidecar, subnet));
  }

  validateGossipFuluDataColumnSidecar(
    _dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateGossipFuluDataColumnSidecar.call(this, dataColumnSidecar, gossipSubnet, this.metrics)
    );
  }

  validateGossipGloasDataColumnSidecar(
    _dataColumnBytes: Uint8Array,
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateGossipGloasDataColumnSidecar.call(this, payloadInput, dataColumnSidecar, gossipSubnet, this.metrics)
    );
  }

  validateGossipPayloadAttestationMessage(
    _payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      const result = await validateGossipPayloadAttestationMessage.call(this, payloadAttestationMessage);
      // Insert into the pool + notify fork choice on Accept (moved from the gossip handler). The rich result
      // is consumed here internally; the facade only needs the Accept/Reject verdict, so nothing is returned.
      this.insertPayloadAttestationOnAccept(payloadAttestationMessage, result, "gossip");
    });
  }

  validateApiPayloadAttestationMessage(
    _payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      const result = await validateApiPayloadAttestationMessage.call(this, payloadAttestationMessage);
      // Insert into the pool + notify fork choice on Accept (moved from the API handler); nothing returned.
      this.insertPayloadAttestationOnAccept(payloadAttestationMessage, result, "api");
    });
  }

  /** Shared post-validation side-effects for a valid payload attestation (pool insert + PTC fork-choice notify). */
  private insertPayloadAttestationOnAccept(
    message: gloas.PayloadAttestationMessage,
    result: PayloadAttestationValidationResult,
    source: "gossip" | "api"
  ): void {
    const {attDataRootHex, validatorCommitteeIndices} = result;
    if (source === "gossip") {
      // Gossip swallows pool-insert errors so a pool failure can't flip the verdict (matches prior handler).
      try {
        const insertOutcome = this.payloadAttestationPool.add(message, attDataRootHex, validatorCommitteeIndices);
        this.metrics?.opPool.payloadAttestationPool.gossipInsertOutcome.inc({insertOutcome});
      } catch (e) {
        this.logger.error("Error adding to payloadAttestation pool", {}, e as Error);
      }
    } else {
      // API path does not swallow (matches prior handler — a pool error surfaces as a submit failure).
      const insertOutcome = this.payloadAttestationPool.add(message, attDataRootHex, validatorCommitteeIndices);
      this.metrics?.opPool.payloadAttestationPool.apiInsertOutcome.inc({insertOutcome});
    }
    this.forkChoice.notifyPtcMessages(
      toRootHex(message.data.beaconBlockRoot),
      message.data.slot,
      validatorCommitteeIndices,
      message.data.payloadPresent,
      message.data.blobDataAvailable
    );
  }

  // The batch attestation validator already returns `Result<T>[]` (caught internally, never throws out);
  // map each item to a `GossipValidationResult` so the batch is FFI-safe too. Per-item bytes live on each
  // `GossipAttestation.serializedData`, so there is no separate leading bytes parameter here.
  async validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[],
    // Per-attestation `aggregatorTracker.shouldAggregate` decision (facade-computed, plain data): insert into
    // the pool only for subnets this node aggregates for. Aligned with `attestations`.
    shouldAddToPool: boolean[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}> {
    const {results, batchableBls} = await validateGossipAttestationsSameAttData.call(this, fork, attestations);
    const mapped = results.map(fromResult);
    // Post-validation side-effects on Accept (moved from the gossip handler): pool insert (gated by the
    // facade's aggregatorTracker decision), then the fork-choice write. Contain errors — a pool/fork-choice
    // error must not flip the gossip verdict.
    for (const [i, res] of mapped.entries()) {
      if (res.status !== GossipValidationStatus.Accept) {
        continue;
      }
      const value = res.value;
      if (shouldAddToPool[i]) {
        try {
          const insertOutcome = this.attestationPool.add(
            value.committeeIndex,
            value.attestation,
            value.attDataRootHex,
            value.validatorCommitteeIndex,
            value.committeeSize
          );
          this.metrics?.opPool.attestationPool.gossipInsertOutcome.inc({insertOutcome});
        } catch (e) {
          this.logger.error("Error adding unaggregated attestation to pool", {subnet: value.subnet}, e as Error);
        }
      }
      if (!this.opts.dontSendGossipAttestationsToForkchoice) {
        try {
          this.forkChoice.onAttestation(value.indexedAttestation, value.attDataRootHex);
        } catch (e) {
          this.logger.debug(
            "Error adding gossip unaggregated attestation to forkchoice",
            {subnet: value.subnet},
            e as Error
          );
        }
      }
    }
    return {results: mapped, batchableBls};
  }

  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>> {
    return runGossipValidation(() => validateApiAttestation.call(this, fork, attestationOrBytes));
  }

  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return runGossipValidation(async () => {
      const result = await validateGossipAggregateAndProof.call(this, fork, signedAggregateAndProof, aggregateBytes);
      // Insert into the aggregated-attestation pool on Accept (moved from the gossip handler).
      const insertOutcome = this.aggregatedAttestationPool.add(
        signedAggregateAndProof.message.aggregate,
        result.attDataRootHex,
        result.indexedAttestation.attestingIndices.length,
        result.committeeValidatorIndices
      );
      this.metrics?.opPool.aggregatedAttestationPool.gossipInsertOutcome.inc({insertOutcome});
      // Fork-choice write on Accept (moved from the gossip handler). Contain errors — a fork-choice error
      // must not flip the gossip verdict.
      if (!this.opts.dontSendGossipAttestationsToForkchoice) {
        try {
          this.forkChoice.onAttestation(result.indexedAttestation, result.attDataRootHex);
        } catch (e) {
          this.logger.debug(
            "Error adding gossip aggregated attestation to forkchoice",
            {slot: result.indexedAttestation.data.slot},
            e as Error
          );
        }
      }
      // The facade only needs `indexedAttestation` (validator monitor); pool/fork-choice fields consumed above.
      return {indexedAttestation: result.indexedAttestation};
    });
  }

  validateApiAggregateAndProof(
    _aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return runGossipValidation(async () => {
      const result = await validateApiAggregateAndProof.call(this, fork, signedAggregateAndProof);
      // Insert into the aggregated-attestation pool on Accept (moved from the API handler).
      const insertOutcome = this.aggregatedAttestationPool.add(
        signedAggregateAndProof.message.aggregate,
        result.attDataRootHex,
        result.indexedAttestation.attestingIndices.length,
        result.committeeValidatorIndices
      );
      this.metrics?.opPool.aggregatedAttestationPool.apiInsertOutcome.inc({insertOutcome});
      return {indexedAttestation: result.indexedAttestation};
    });
  }

  validateGossipExecutionPayloadEnvelope(
    _envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    bidBuilderIndex: ValidatorIndex,
    bidBlockHashHex: RootHex,
    bidExecutionRequestsRoot: Root
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateGossipExecutionPayloadEnvelope.call(
        this,
        executionPayloadEnvelope,
        proposerIndex,
        bidBuilderIndex,
        bidBlockHashHex,
        bidExecutionRequestsRoot
      )
    );
  }

  validateApiExecutionPayloadEnvelope(
    _envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    bidBuilderIndex: ValidatorIndex,
    bidBlockHashHex: RootHex,
    bidExecutionRequestsRoot: Root
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateApiExecutionPayloadEnvelope.call(
        this,
        executionPayloadEnvelope,
        proposerIndex,
        bidBuilderIndex,
        bidBlockHashHex,
        bidExecutionRequestsRoot
      )
    );
  }

  validateGossipExecutionPayloadBid(
    _bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
    return runGossipValidation(async () => {
      const result = await validateGossipExecutionPayloadBid.call(this, signedExecutionPayloadBid);
      // Insert into the bid pool on Accept (moved from the gossip handler).
      try {
        const insertOutcome = this.executionPayloadBidPool.add(signedExecutionPayloadBid);
        this.metrics?.opPool.executionPayloadBidPool.gossipInsertOutcome.inc({insertOutcome});
      } catch (e) {
        this.logger.error("Error adding to executionPayloadBid pool", {}, e as Error);
      }
      return result;
    });
  }

  validateApiExecutionPayloadBid(
    _bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      await validateApiExecutionPayloadBid.call(this, signedExecutionPayloadBid);
      // Insert into the bid pool on Accept (moved from the API handler); the facade only needs the verdict.
      try {
        const insertOutcome = this.executionPayloadBidPool.add(signedExecutionPayloadBid);
        this.metrics?.opPool.executionPayloadBidPool.apiInsertOutcome.inc({insertOutcome});
      } catch (e) {
        this.logger.error("Error adding to executionPayloadBid pool", {}, e as Error);
      }
    });
  }

  async validateGossipProposerPreferences(
    _preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>> {
    const res = await runGossipValidation(() =>
      validateGossipProposerPreferences.call(this, signedProposerPreferences)
    );
    // Insert on Accept — the pool is engine-internal, so the facade (gossip handler / API) no longer adds.
    if (res.status === GossipValidationStatus.Accept) {
      this.proposerPreferencesPool.add(signedProposerPreferences);
    }
    return res;
  }

  // --- Op pool: gossip validate (+ insert on Accept) / API validate (throws, + insert) / REST reads ---
  // The pools are engine-internal (not on IBeaconEngine's cache surface); the facade reaches them only
  // through these narrow methods. gossip = no-throw result; API = throws (preserves REST error shape).

  async validateGossipAttesterSlashing(
    attesterSlashing: AttesterSlashing,
    fork: ForkName
  ): Promise<GossipValidationResult<void>> {
    const res = await runGossipValidation(() => validateGossipAttesterSlashing.call(this, attesterSlashing));
    if (res.status === GossipValidationStatus.Accept) {
      // Contain insert failures — a pool error must not flip the gossip verdict (matches prior handler).
      try {
        this.opPool.insertAttesterSlashing(fork, attesterSlashing);
        this.forkChoice.onAttesterSlashing(attesterSlashing);
      } catch (e) {
        this.logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    }
    return res;
  }

  async validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void> {
    await validateApiAttesterSlashing.call(this, attesterSlashing);
    this.opPool.insertAttesterSlashing(fork, attesterSlashing);
  }

  async validateGossipProposerSlashing(
    proposerSlashing: phase0.ProposerSlashing
  ): Promise<GossipValidationResult<void>> {
    const res = await runGossipValidation(() => validateGossipProposerSlashing.call(this, proposerSlashing));
    if (res.status === GossipValidationStatus.Accept) {
      try {
        this.opPool.insertProposerSlashing(proposerSlashing);
      } catch (e) {
        this.logger.error("Error adding proposerSlashing to pool", {}, e as Error);
      }
    }
    return res;
  }

  async validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    await validateApiProposerSlashing.call(this, proposerSlashing);
    this.opPool.insertProposerSlashing(proposerSlashing);
  }

  async validateGossipVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<GossipValidationResult<void>> {
    const res = await runGossipValidation(() => validateGossipVoluntaryExit.call(this, voluntaryExit));
    if (res.status === GossipValidationStatus.Accept) {
      try {
        this.opPool.insertVoluntaryExit(voluntaryExit);
      } catch (e) {
        this.logger.error("Error adding voluntaryExit to pool", {}, e as Error);
      }
    }
    return res;
  }

  async validateApiVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<void> {
    await validateApiVoluntaryExit.call(this, voluntaryExit);
    this.opPool.insertVoluntaryExit(voluntaryExit);
  }

  async validateGossipBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange
  ): Promise<GossipValidationResult<void>> {
    const res = await runGossipValidation(() => validateGossipBlsToExecutionChange.call(this, blsToExecutionChange));
    if (res.status === GossipValidationStatus.Accept) {
      try {
        this.opPool.insertBlsToExecutionChange(blsToExecutionChange);
      } catch (e) {
        this.logger.error("Error adding blsToExecutionChange to pool", {}, e as Error);
      }
    }
    return res;
  }

  async validateApiBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    preCapella: boolean
  ): Promise<void> {
    await validateApiBlsToExecutionChange.call(this, blsToExecutionChange);
    this.opPool.insertBlsToExecutionChange(blsToExecutionChange, preCapella);
  }

  getPoolProposerPreferences(slot?: Slot): gloas.SignedProposerPreferences[] {
    return this.proposerPreferencesPool.getAll(slot);
  }

  getPoolAttesterSlashings(): AttesterSlashing[] {
    return this.opPool.getAllAttesterSlashings();
  }

  getPoolProposerSlashings(): phase0.ProposerSlashing[] {
    return this.opPool.getAllProposerSlashings();
  }

  getPoolVoluntaryExits(): phase0.SignedVoluntaryExit[] {
    return this.opPool.getAllVoluntaryExits();
  }

  getPoolBlsToExecutionChanges(): capella.SignedBLSToExecutionChange[] {
    return this.opPool.getAllBlsToExecutionChanges().map(({data}) => data);
  }

  // --- Op pools (engine-internal): narrow add/read bridges for gossip handlers + REST/validator API ---
  // The pools are engine-owned; the facade reaches them only through these methods (never the objects).

  addAttestationToPool(
    committeeIndex: CommitteeIndex,
    attestation: SingleAttestation,
    attDataRootHex: RootHex,
    validatorCommitteeIndex: number,
    committeeSize: number,
    priority?: boolean
  ): InsertOutcome {
    return this.attestationPool.add(
      committeeIndex,
      attestation,
      attDataRootHex,
      validatorCommitteeIndex,
      committeeSize,
      priority
    );
  }

  getAttestationAggregate(slot: Slot, dataRootHex: RootHex, committeeIndex: CommitteeIndex): Attestation | null {
    return this.attestationPool.getAggregate(slot, dataRootHex, committeeIndex);
  }

  getPoolAggregatedAttestations(bySlot?: Slot): Attestation[] {
    return this.aggregatedAttestationPool.getAll(bySlot);
  }

  getSyncCommitteeContribution(
    subnet: SubcommitteeIndex,
    slot: Slot,
    prevBlockRoot: Root
  ): altair.SyncCommitteeContribution | null {
    return this.syncCommitteeMessagePool.getContribution(subnet, slot, prevBlockRoot);
  }

  getPoolPayloadAttestations(slot?: Slot): gloas.PayloadAttestation[] {
    return this.payloadAttestationPool.getAll(slot);
  }

  // --- Proposer cache + finalized balances (engine-internal) ---

  /** Fee recipient registered for a proposer, or undefined if none (block-production default is
   * resolved in `produceBlockBase`; import uses this for its FCU fee recipient). */
  getProposerFeeRecipient(proposerIndex: ValidatorIndex): string | undefined {
    return this.beaconProposerCache.get(proposerIndex);
  }

  /** Register proposer preparation data. Returns true if new validators were discovered. */
  updateProposerPreparation(epoch: Epoch, proposers: ProposerPreparationData[]): boolean {
    const previousValidatorCount = this.beaconProposerCache.getValidatorIndices().length;
    for (const proposer of proposers) {
      this.beaconProposerCache.add(epoch, proposer);
    }
    return this.beaconProposerCache.getValidatorIndices().length > previousValidatorCount;
  }

  /** Validator indices with proposer preparation registered (attached validators). */
  getProposerCacheValidatorIndices(): ValidatorIndex[] {
    return this.beaconProposerCache.getValidatorIndices();
  }

  /** Cached finalized effective-balance increments for a checkpoint, or undefined if not cached. */
  getCheckpointEffectiveBalances(checkpoint: CheckpointWithHex): EffectiveBalanceIncrements | undefined {
    return this.checkpointBalancesCache.get(checkpoint);
  }

  /** Prune the (internal) op pool + seen-block-proposers on finalization — driven by the facade's finalized event. */
  async pruneOnFinalized(): Promise<void> {
    this.seenBlockProposers.prune(computeStartSlotAtEpoch(this.forkChoice.getFinalizedCheckpoint().epoch));

    // TODO: Improve using regen here
    const {blockRoot, stateRoot, slot} = this.forkChoice.getHead();
    const headState = this.regen.getStateSync(stateRoot);
    const res = await this.getSerializedBlockByRoot(fromHex(blockRoot));
    if (res == null) {
      throw Error(`Head block for ${slot} is not available in cache or database`);
    }
    if (headState) {
      const headBlock = this.config.getForkTypes(res.slot).SignedBeaconBlock.deserialize(res.bytes);
      this.opPool.pruneAll(headBlock, headState);
    } else {
      this.logger.verbose("Head state is null");
    }
  }

  /** Liveness: whether the validator was seen via imported blocks or gossip/API in the epoch. */
  validatorSeenAtEpoch(index: ValidatorIndex, epoch: Epoch): boolean {
    return (
      // Dedicated liveness cache, registers attesters seen through imported blocks.
      this.seenBlockAttesters.isKnown(epoch, index) ||
      // seenAttesters = single signer of unaggregated attestations
      this.seenAttesters.isKnown(epoch, index) ||
      // seenAggregators = single aggregator index, not participants of the aggregate
      this.seenAggregators.isKnown(epoch, index) ||
      // seenPayloadAttesters = single signer of payload attestation message
      this.seenPayloadAttesters.isKnown(epoch, index) ||
      // seenBlockProposers = single block proposer
      this.seenBlockProposers.seenAtEpoch(epoch, index)
    );
  }

  /** Whether a block proposer was already seen for this slot (sync anti-unbundling check). */
  isBlockProposerSeen(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.seenBlockProposers.isKnown(slot, proposerIndex);
  }

  async verifyBlocks(
    _blockBytes: Uint8Array[],
    parentBlock: ProtoBlock,
    blockInputs: IBlockInput[],
    opts: BlockProcessOpts & ImportBlockOpts,
    signal: AbortSignal
  ): Promise<{verifyStateTime: number; verifySignaturesTime: number}> {
    const blocks = blockInputs.map((bi) => bi.getBlock());
    const block0 = blocks[0];
    if (!block0) throw Error("Empty blockInputs");
    const block0Epoch = computeEpochAtSlot(block0.message.slot);
    const fork = this.config.getForkSeq(block0.message.slot);

    const preState0 = await this.regen
      .getPreState(block0.message, {dontTransferCache: false}, RegenCaller.processBlocksInEpoch)
      .catch((e) => {
        throw new BlockError(block0, {code: BlockErrorCode.PRESTATE_MISSING, error: e as Error});
      });

    this.shufflingCache.processState(preState0);

    if (block0Epoch !== computeEpochAtSlot(preState0.slot)) {
      throw Error(`preState at slot ${preState0.slot} must be dialed to block epoch ${block0Epoch}`);
    }

    const indexedAttestationsByBlock: IndexedAttestation[][] = [];
    for (const [i, block] of blocks.entries()) {
      indexedAttestationsByBlock[i] = block.message.body.attestations.map((attestation) => {
        const attEpoch = computeEpochAtSlot(attestation.data.slot);
        const decisionRoot = preState0.getShufflingDecisionRoot(attEpoch);
        return this.shufflingCache.getIndexedAttestation(attEpoch, decisionRoot, fork, attestation);
      });
    }

    const [{postStates, proposerBalanceDeltas, verifyStateTime}, {verifySignaturesTime}] = await Promise.all([
      verifyBlocksStateTransitionOnly(
        preState0,
        blockInputs,
        blocks.map(() => DataAvailabilityStatus.Available),
        this.logger,
        this.metrics,
        this.validatorMonitor,
        signal,
        opts
      ),
      opts.skipVerifyBlockSignatures !== true
        ? verifyBlocksSignatures(
            this.config,
            this.bls,
            this.logger,
            this.metrics,
            preState0,
            blocks,
            indexedAttestationsByBlock,
            opts
          )
        : Promise.resolve({verifySignaturesTime: Date.now()}),
    ]);

    for (let i = 0; i < blockInputs.length; i++) {
      const blockInput = blockInputs[i];
      const blockRootHex = blockInput.blockRootHex;
      this.verifiedBlocks.set(blockRootHex, {
        postState: postStates[i],
        blockInput,
        indexedAttestations: indexedAttestationsByBlock[i],
        proposerBalanceDelta: proposerBalanceDeltas[i],
        parentBlockSlot: i === 0 ? parentBlock.slot : blocks[i - 1].message.slot,
        seenTimestampSec: opts.seenTimestampSec ?? Math.floor(Date.now() / 1000),
      });
    }

    return {verifyStateTime, verifySignaturesTime};
  }

  async importBlock(
    blockRoot: Root,
    executionStatus: BlockExecutionStatus | PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult> {
    // bytes-first input (native engine FFI); the JS cache is keyed by hex.
    const blockRootHex = toRootHex(blockRoot);
    const v = this.verifiedBlocks.get(blockRootHex);
    if (!v) throw Error(`No verified block found for root ${blockRootHex}`);

    try {
      return await this._importBlock(v, executionStatus, dataAvailabilityStatus, opts);
    } finally {
      this.verifiedBlocks.delete(blockRootHex);
    }
  }

  /**
   * Verify a gloas execution payload envelope before importing it: resolve the block's state (regen),
   * check the envelope fields against it, and verify the BLS signature (skipped when gossip/API already
   * did — `opts.validSignature`). Consensus-only; the EL `notifyNewPayload` runs facade-side in parallel
   * with this (mirrors the block pipeline's state/sig ∥ EL split). Throws `PayloadError` on failure.
   *
   * `_envelopeBytes` is the SSZ bytes of `signedEnvelope` — the JS engine works off the POJO and ignores
   * it; the native engine deserializes from it (bytes-first FFI, `(bytes, pojo)` seam, like `verifyBlocks`).
   */
  async verifyExecutionPayloadEnvelope(
    _envelopeBytes: Uint8Array,
    signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    opts: {validSignature: boolean}
  ): Promise<void> {
    const envelope = signedEnvelope.message;
    const blockRootHex = toRootHex(envelope.beaconBlockRoot);

    // Get the ProtoBlock for the block whose payload this envelope carries.
    const protoBlock = this.forkChoice.getBlockHexDefaultStatus(blockRootHex);
    if (!protoBlock) {
      throw new PayloadError({code: PayloadErrorCode.BLOCK_NOT_IN_FORK_CHOICE, blockRootHex});
    }

    // Regenerate state for envelope verification.
    const blockState = await this.regen
      .getBlockSlotState(protoBlock, protoBlock.slot, {dontTransferCache: true}, RegenCaller.importExecutionPayload)
      .catch(() =>
        // only happen at the 1st batch of skipped slot checkpoint sync
        this.regen.getClosestHeadState(protoBlock)
      );

    if (blockState == null) {
      throw new PayloadError({code: PayloadErrorCode.MISS_BLOCK_STATE, blockRootHex: protoBlock.blockRoot});
    }
    if (!isStatePostGloas(blockState)) {
      throw new PayloadError({
        code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR,
        message: `Expected gloas+ state for payload import, got fork=${blockState.forkName}`,
      });
    }

    // Verify envelope fields against state. When validSignature is true, gossip/API already verified
    // both the signature and the executionRequestsRoot, so we skip those checks here.
    try {
      verifyExecutionPayloadEnvelopeFields(this.config, blockState, envelope, {
        verifyExecutionRequestsRoot: !opts.validSignature,
      });
    } catch (e) {
      throw new PayloadError(
        {code: PayloadErrorCode.ENVELOPE_VERIFICATION_ERROR, message: (e as Error).message},
        `Envelope verification error: ${(e as Error).message}`
      );
    }

    if (opts.validSignature !== true) {
      const signatureValid = await verifyExecutionPayloadEnvelopeSignature(
        this.config,
        blockState,
        this.pubkeyCache,
        signedEnvelope,
        proposerIndex,
        this.bls
      );
      if (!signatureValid) {
        throw new PayloadError({code: PayloadErrorCode.INVALID_SIGNATURE});
      }
    }
  }

  /**
   * Import a verified execution payload envelope into fork choice (transitions the block's PENDING
   * variant to FULL) and compute the post-import FCU decision. The facade fires the EL calls
   * (`notifyNewPayload` before this, `notifyForkchoiceUpdate` from the returned `fcuUpdate`) and emits
   * events. `execStatus` is the EL result mapped facade-side; `blockRoot` is bytes-first (native FFI).
   */
  importExecutionPayload(
    blockRoot: Root,
    blockHashHex: RootHex,
    payloadBlockNumber: number,
    payloadGasLimit: number,
    execStatus: PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): {fcuUpdate: FcuUpdate | null; executionOptimistic: boolean} {
    const blockRootHex = toRootHex(blockRoot);

    this.forkChoice.onExecutionPayload(
      blockRootHex,
      blockHashHex,
      payloadBlockNumber,
      payloadGasLimit,
      execStatus,
      dataAvailabilityStatus
    );

    // Fire the FCU only when this payload's block is the canonical head.
    const head = this.forkChoice.getHead();
    let fcuUpdate: FcuUpdate | null = null;
    if (blockRootHex === head.blockRoot) {
      fcuUpdate = {
        fork: this.config.getForkName(head.slot),
        headBlockHash: blockHashHex,
        safeBlockHash: getSafeExecutionBlockHash(this.forkChoice),
        finalizedBlockHash: this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX,
      };
    }

    return {fcuUpdate, executionOptimistic: execStatus === ExecutionStatus.Syncing};
  }

  private async _importBlock(
    v: VerifiedBlockBundle,
    executionStatus: BlockExecutionStatus | PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult> {
    const {blockInput, postState, parentBlockSlot, indexedAttestations, proposerBalanceDelta, seenTimestampSec} = v;
    let execStatus = executionStatus;
    const block = blockInput.getBlock();
    const source = blockInput.getBlockSource();
    const {slot: blockSlot} = block.message;
    const blockRootHex = blockInput.blockRootHex;
    const currentSlot = this.forkChoice.getTime();
    const currentEpoch = computeEpochAtSlot(currentSlot);
    const blockEpoch = computeEpochAtSlot(blockSlot);
    const prevFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
    const blockDelaySec = seenTimestampSec - computeTimeAtSlot(this.config, blockSlot, postState.genesisTime);
    const fork = this.config.getForkSeq(blockSlot);
    const isExecutionState = isStatePostBellatrix(postState) && postState.isExecutionStateType;

    // 2. Import block to fork choice
    this.checkpointBalancesCache.processState(blockRootHex, postState);
    if (fork >= ForkSeq.gloas) {
      const parentRootHex = toRootHex(block.message.parentRoot);
      const parentBlock = this.forkChoice.getBlockHexDefaultStatus(parentRootHex);
      if (parentBlock === null) {
        throw Error(`Parent block not found in forkChoice, parentRoot=${parentRootHex}`);
      }
      if (parentBlock.executionStatus === ExecutionStatus.Invalid) {
        throw Error(`Parent block has invalid execution status, parentRoot=${parentRootHex}`);
      }
      execStatus = parentBlock.executionStatus;
    }

    // getBeaconProposerOrNull returns null if the head state is more than one epoch away from the
    // block slot; we skip the proposer-boost canonical check as we cannot determine the proposer.
    const expectedProposerIndex: number | null = this.getHeadState().getBeaconProposerOrNull(blockSlot);

    const blockSummary = this.forkChoice.onBlock(
      block.message,
      postState,
      blockDelaySec,
      currentSlot,
      execStatus,
      dataAvailabilityStatus,
      expectedProposerIndex
    );

    this.regen.processState(blockRootHex, postState);
    this.metrics?.importBlock.bySource.inc({source: source.source});
    this.logger.verbose("Added block to forkchoice and state cache", {slot: blockSlot, root: blockRootHex});

    // 3. Import attestations to fork choice
    const FORK_CHOICE_ATT_EPOCH_LIMIT = 1;

    if (
      opts.importAttestations === AttestationImportOpt.Force ||
      (opts.importAttestations !== AttestationImportOpt.Skip &&
        blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT)
    ) {
      const attestations = block.message.body.attestations;
      const rootCache = new RootCache(postState);
      const invalidAttestationErrorsByCode = new Map<string, {error: Error; count: number}>();

      const addAttestation =
        fork >= ForkSeq.electra ? this.addAttestationPostElectra.bind(this) : this.addAttestationPreElectra.bind(this);

      for (let i = 0; i < attestations.length; i++) {
        const attestation = attestations[i];
        try {
          const indexedAttestation = indexedAttestations[i];
          const {target, beaconBlockRoot} = attestation.data;
          const attDataRoot = toRootHex(ssz.phase0.AttestationData.hashTreeRoot(indexedAttestation.data));

          addAttestation(
            postState,
            target,
            attDataRoot,
            attestation as Attestation<ForkPostElectra>,
            indexedAttestation
          );

          if (
            opts.importAttestations === AttestationImportOpt.Force ||
            (target.epoch <= currentEpoch && target.epoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT)
          ) {
            this.forkChoice.onAttestation(
              indexedAttestation,
              attDataRoot,
              opts.importAttestations === AttestationImportOpt.Force
            );
          }

          // Register attesters seen in this block for the liveness cache (engine-owned).
          this.seenBlockAttesters.addIndices(blockEpoch, Array.from(indexedAttestation.attestingIndices));

          const correctHead = ssz.Root.equals(rootCache.getBlockRootAtSlot(attestation.data.slot), beaconBlockRoot);
          const missedSlotVote =
            attestation.data.slot > GENESIS_SLOT &&
            ssz.Root.equals(
              rootCache.getBlockRootAtSlot(attestation.data.slot - 1),
              rootCache.getBlockRootAtSlot(attestation.data.slot)
            );
          this.validatorMonitor?.registerAttestationInBlock(
            indexedAttestation,
            parentBlockSlot,
            correctHead,
            missedSlotVote,
            blockRootHex,
            blockSlot
          );
        } catch (e) {
          if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
            let errWithCount = invalidAttestationErrorsByCode.get(e.type.err.code);
            if (errWithCount === undefined) {
              errWithCount = {error: e as Error, count: 1};
              invalidAttestationErrorsByCode.set(e.type.err.code, errWithCount);
            } else {
              errWithCount.count++;
            }
          } else {
            this.logger.warn("Error processing attestation from block", {slot: blockSlot}, e as Error);
          }
        }
      }

      for (const {error, count} of invalidAttestationErrorsByCode.values()) {
        this.logger.warn(
          "Error processing attestations from block",
          {slot: blockSlot, erroredAttestations: count},
          error
        );
      }
    }

    // 4. Import attester slashings
    if (
      opts.importAttestations === AttestationImportOpt.Force ||
      (opts.importAttestations !== AttestationImportOpt.Skip &&
        blockEpoch >= currentEpoch - FORK_CHOICE_ATT_EPOCH_LIMIT - 1 - MAX_SEED_LOOKAHEAD)
    ) {
      for (const slashing of block.message.body.attesterSlashings) {
        try {
          this.forkChoice.onAttesterSlashing(slashing);
        } catch (e) {
          this.logger.warn("Error processing AttesterSlashing from block", {slot: blockSlot}, e as Error);
        }
      }
    }

    // 4.5. Import payload attestations (Gloas)
    if (isGloasBeaconBlock(block.message)) {
      for (const payloadAttestation of block.message.body.payloadAttestations) {
        try {
          const ptcIndices: number[] = [];
          for (let i = 0; i < payloadAttestation.aggregationBits.bitLen; i++) {
            if (payloadAttestation.aggregationBits.get(i)) {
              ptcIndices.push(i);
            }
          }
          if (ptcIndices.length > 0) {
            this.forkChoice.notifyPtcMessages(
              toRootHex(payloadAttestation.data.beaconBlockRoot),
              payloadAttestation.data.slot,
              ptcIndices,
              payloadAttestation.data.payloadPresent,
              payloadAttestation.data.blobDataAvailable
            );
          }
        } catch (e) {
          this.logger.warn("Error processing PayloadAttestation from block", {slot: blockSlot}, e as Error);
        }
      }
    }

    // 5. Compute head
    const oldHead = this.forkChoice.getHead();
    const oldHeadBlockRoot = oldHead.blockRoot;

    this.metrics?.forkChoice.requests.inc();
    const newHeadTimer = this.metrics?.forkChoice.findHead.startTimer({caller: ForkchoiceCaller.importBlock});
    let newHead: ProtoBlock;
    try {
      newHead = this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetCanonicalHead}).head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetCanonicalHead});
      throw e;
    } finally {
      newHeadTimer?.();
    }

    const currFinalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;

    let headChanged = false;
    let headResult: ImportBlockResult["head"] = null;
    let reorg: ReorgEventData | null = null;

    if (newHead.blockRoot !== oldHead.blockRoot) {
      headChanged = true;

      this.regen.updateHeadState(newHead, postState);

      try {
        headResult = {
          block: newHead.blockRoot,
          epochTransition: computeStartSlotAtEpoch(computeEpochAtSlot(newHead.slot)) === newHead.slot,
          slot: newHead.slot,
          state: newHead.stateRoot,
          previousDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.previous),
          currentDutyDependentRoot: this.forkChoice.getDependentRoot(newHead, EpochDifference.current),
          executionOptimistic: isOptimisticBlock(newHead),
        };
      } catch (e) {
        this.logger.debug("Error building head event data", {slot: newHead.slot, root: newHead.blockRoot}, e as Error);
      }

      const delaySec = this.clock.secFromSlot(newHead.slot);
      this.logger.verbose("New chain head", {slot: newHead.slot, root: newHead.blockRoot, delaySec});

      if (this.metrics) {
        this.metrics.headSlot.set(newHead.slot);
        if (delaySec < (SLOTS_PER_EPOCH * this.config.SLOT_DURATION_MS) / 1000) {
          this.metrics.importBlock.elapsedTimeTillBecomeHead.observe(delaySec);
          const cutOffSec = this.config.getAttestationDueMs(this.config.getForkName(blockSlot)) / 1000;
          if (delaySec > cutOffSec) {
            this.metrics.importBlock.setHeadAfterCutoff.inc();
          }
        }
      }

      this.syncContributionAndProofPool.prune(newHead.slot);
      this.seenContributionAndProof.prune(newHead.slot);

      this.metrics?.forkChoice.changedHead.inc();

      const ancestorResult = this.forkChoice.getCommonAncestorDepth(oldHead, newHead);
      if (ancestorResult.code === AncestorStatus.CommonAncestor) {
        reorg = {
          depth: ancestorResult.depth,
          epoch: computeEpochAtSlot(newHead.slot),
          slot: newHead.slot,
          newHeadBlock: newHead.blockRoot,
          oldHeadBlock: oldHead.blockRoot,
          newHeadState: newHead.stateRoot,
          oldHeadState: oldHead.stateRoot,
          executionOptimistic: isOptimisticBlock(newHead),
        };
        this.metrics?.forkChoice.reorg.inc();
        this.metrics?.forkChoice.reorgDistance.observe(ancestorResult.depth);
      }

      if (blockEpoch >= this.config.ALTAIR_FORK_EPOCH) {
        callInNextEventLoop(() => {
          try {
            if (isStatePostAltair(postState)) {
              this.lightClientServer?.onImportBlockHead(
                block.message as BeaconBlock<ForkPostAltair>,
                postState,
                parentBlockSlot
              );
            }
          } catch (e) {
            this.logger.verbose("Error lightClientServer.onImportBlock", {slot: blockSlot}, e as Error);
          }
        });
      }
    }

    const parentEpoch = computeEpochAtSlot(parentBlockSlot);
    if (parentEpoch < blockEpoch) {
      this.shufflingCache.processState(postState);
      this.logger.verbose("Processed shuffling for next epoch", {parentEpoch, blockEpoch, slot: blockSlot});
    }

    if (blockSlot % SLOTS_PER_EPOCH === 0) {
      const checkpointState = postState;
      const cp = getCheckpointFromState(checkpointState);
      this.regen.addCheckpointState(cp, checkpointState);
      this.emitter.emit(ChainEvent.checkpoint, cp, checkpointState);
      this.logger.verbose("Checkpoint processed", toCheckpointHex(cp));

      const activeValidatorsCount = checkpointState.activeValidatorCount;
      this.metrics?.currentActiveValidators.set(activeValidatorsCount);
      this.metrics?.currentValidators.set({status: "active"}, activeValidatorsCount);

      const parentBlockSummary = isGloasBeaconBlock(block.message)
        ? this.forkChoice.getBlockHexAndBlockHash(
            toRootHex(checkpointState.latestBlockHeader.parentRoot),
            toRootHex(block.message.body.signedExecutionPayloadBid.message.parentBlockHash)
          )
        : this.forkChoice.getBlockDefaultStatus(checkpointState.latestBlockHeader.parentRoot);

      if (parentBlockSummary) {
        const justifiedCheckpoint = checkpointState.currentJustifiedCheckpoint;
        const justifiedEpoch = justifiedCheckpoint.epoch;
        const preJustifiedEpoch = parentBlockSummary.justifiedEpoch;
        if (justifiedEpoch > preJustifiedEpoch) {
          this.logger.verbose("Checkpoint justified", toCheckpointHex(justifiedCheckpoint));
          this.metrics?.previousJustifiedEpoch.set(checkpointState.previousJustifiedCheckpoint.epoch);
          this.metrics?.currentJustifiedEpoch.set(justifiedCheckpoint.epoch);
        }
        const finalizedCheckpoint = checkpointState.finalizedCheckpoint;
        const finalizedEpoch = finalizedCheckpoint.epoch;
        const preFinalizedEpoch = parentBlockSummary.finalizedEpoch;
        if (finalizedEpoch > preFinalizedEpoch) {
          this.emitter.emit(routes.events.EventType.finalizedCheckpoint, {
            block: toRootHex(finalizedCheckpoint.root),
            epoch: finalizedCheckpoint.epoch,
            state: toRootHex(checkpointState.hashTreeRoot()),
            executionOptimistic: false,
          });
          this.logger.verbose("Checkpoint finalized", toCheckpointHex(finalizedCheckpoint));
          this.metrics?.finalizedEpoch.set(finalizedCheckpoint.epoch);
        }
      }
    }

    let proposerIndexNextSlot: number | null = null;
    if (blockSlot >= currentSlot && isExecutionState) {
      try {
        proposerIndexNextSlot = postState.getBeaconProposer(blockSlot + 1);
      } catch {
        // epoch boundary, proposer shuffle not yet stable
      }
    }

    if (!postState.isStateValidatorsNodesPopulated()) {
      this.logger.verbose("After importBlock caching postState without SSZ cache", {slot: postState.slot});
    }

    this.metrics?.parentBlockDistance.observe(blockSlot - parentBlockSlot);
    this.metrics?.proposerBalanceDeltaAny.observe(proposerBalanceDelta);
    this.validatorMonitor?.registerImportedBlock(block.message, {proposerBalanceDelta});
    if (isStatePostAltair(postState)) {
      this.validatorMonitor?.registerSyncAggregateInBlock(
        blockEpoch,
        (block as altair.SignedBeaconBlock).message.body.syncAggregate,
        postState.currentSyncCommitteeIndexed.validatorIndices
      );
    }

    if (isBlockInputColumns(blockInput)) {
      for (const {source} of blockInput.getSampledColumnsWithSource()) {
        this.metrics?.dataColumns.bySource.inc({source});
      }
    } else if (isBlockInputBlobs(blockInput)) {
      for (const {source} of blockInput.getAllBlobsWithSource()) {
        this.metrics?.importBlock.blobsBySource.inc({blobsSource: source});
      }
    }

    // 6. Compute the FCU-override decision + notifyForkchoiceUpdate args engine-side; the facade fires
    // the EL call (executionEngine is facade-owned) or skips based on `fcuUpdate`.
    const fcuUpdate = this.computeImportFcuUpdate({
      isExecutionState,
      blockSlot,
      currentSlot,
      blockRootHex,
      blockSummary,
      proposerIndexNextSlot,
      newHeadBlockRoot: newHead.blockRoot,
      oldHeadBlockRoot,
      currFinalizedEpoch,
      prevFinalizedEpoch,
    });

    return {
      headChanged,
      head: headResult,
      reorg,
      blockSummary,
      proposerIndexNextSlot,
      isExecutionState,
      prevFinalizedEpoch,
      currFinalizedEpoch,
      oldHeadBlockRoot,
      newHeadBlockRoot: newHead.blockRoot,
      fcuUpdate,
      newHead,
      blockMeta: {
        slot: blockSlot,
        blockRootHex,
        proposerBalanceDelta,
        parentBlockSlot,
        seenTimestampSec,
      },
    };
  }

  /**
   * Decide whether to fire a forkchoice-update on the EL after importing a block, and if so return the
   * notifyForkchoiceUpdate args. All fork-choice + proposer-cache reads are engine-internal; the facade
   * only fires the EL call (or skips) from the returned data. Also emits the `notOverrideFcuReason`
   * metric + weak/strong-block logs (engine owns metrics/logger). `disableImportExecutionFcU` stays a
   * facade-side gate applied to the returned value.
   *
   * Returns `null` when there is nothing to fire: non-execution state, weak block (`shouldOverrideFcu`),
   * no head/finalized change, or the head execution block hash is ZERO.
   */
  private computeImportFcuUpdate(args: {
    isExecutionState: boolean;
    blockSlot: Slot;
    currentSlot: Slot;
    blockRootHex: RootHex;
    blockSummary: ProtoBlock | null;
    proposerIndexNextSlot: number | null;
    newHeadBlockRoot: string;
    oldHeadBlockRoot: string;
    currFinalizedEpoch: number;
    prevFinalizedEpoch: number;
  }): FcuUpdate | null {
    const {
      isExecutionState,
      blockSlot,
      currentSlot,
      blockRootHex,
      blockSummary,
      proposerIndexNextSlot,
      newHeadBlockRoot,
      oldHeadBlockRoot,
      currFinalizedEpoch,
      prevFinalizedEpoch,
    } = args;

    let shouldOverrideFcu = false;

    if (isExecutionState && blockSlot >= currentSlot) {
      let notOverrideFcuReason = NotReorgedReason.Unknown;
      const proposalSlot = blockSlot + 1;
      try {
        if (proposerIndexNextSlot !== null) {
          const feeRecipient = this.getProposerFeeRecipient(proposerIndexNextSlot);
          if (feeRecipient && blockSummary !== null) {
            const result = this.forkChoice.shouldOverrideForkChoiceUpdate(
              blockSummary,
              this.clock.secFromSlot(currentSlot),
              currentSlot
            );
            shouldOverrideFcu = result.shouldOverrideFcu;
            if (!result.shouldOverrideFcu) {
              notOverrideFcuReason = result.reason;
            }
          } else {
            notOverrideFcuReason = NotReorgedReason.NotProposerOfNextSlot;
          }
        } else {
          if (isStartSlotOfEpoch(proposalSlot)) {
            notOverrideFcuReason = NotReorgedReason.NotShufflingStable;
          }
        }
      } catch (e) {
        if (isStartSlotOfEpoch(proposalSlot)) {
          notOverrideFcuReason = NotReorgedReason.NotShufflingStable;
        } else {
          this.logger.warn("Unable to get beacon proposer. Do not override fcu.", {proposalSlot}, e as Error);
        }
      }

      if (shouldOverrideFcu) {
        this.logger.verbose("Weak block detected. Skip fcu call in importBlock", {
          blockRoot: blockRootHex,
          slot: blockSlot,
        });
      } else {
        this.metrics?.importBlock.notOverrideFcuReason.inc({reason: notOverrideFcuReason});
        this.logger.verbose("Strong block detected. Not override fcu call", {
          blockRoot: blockRootHex,
          slot: blockSlot,
          reason: notOverrideFcuReason,
        });
      }
    }

    if ((newHeadBlockRoot !== oldHeadBlockRoot || currFinalizedEpoch !== prevFinalizedEpoch) && !shouldOverrideFcu) {
      const head = this.forkChoice.getHead();
      const headBlockHash = head.executionPayloadBlockHash ?? ZERO_HASH_HEX;
      if (headBlockHash !== ZERO_HASH_HEX) {
        return {
          fork: this.config.getForkName(head.slot),
          headBlockHash,
          safeBlockHash: getSafeExecutionBlockHash(this.forkChoice),
          finalizedBlockHash: this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX,
        };
      }
    }

    return null;
  }

  private addAttestationPreElectra(
    _state: IBeaconStateView,
    target: phase0.Checkpoint,
    attDataRoot: string,
    attestation: Attestation,
    indexedAttestation: phase0.IndexedAttestation
  ): void {
    this.seenAggregatedAttestations.add(
      target.epoch,
      attestation.data.index,
      attDataRoot,
      {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
      true
    );
  }

  private addAttestationPostElectra(
    state: IBeaconStateView,
    target: phase0.Checkpoint,
    attDataRoot: string,
    attestation: Attestation<ForkPostElectra>,
    indexedAttestation: electra.IndexedAttestation
  ): void {
    const committeeIndices = attestation.committeeBits.getTrueBitIndexes();
    if (committeeIndices.length === 1) {
      this.seenAggregatedAttestations.add(
        target.epoch,
        committeeIndices[0],
        attDataRoot,
        {aggregationBits: attestation.aggregationBits, trueBitCount: indexedAttestation.attestingIndices.length},
        true
      );
    } else {
      const attSlot = attestation.data.slot;
      const attEpoch = computeEpochAtSlot(attSlot);
      const decisionRoot = state.getShufflingDecisionRoot(attEpoch);
      const committees = this.shufflingCache.getBeaconCommittees(attEpoch, decisionRoot, attSlot, committeeIndices);
      const aggregationBools = attestation.aggregationBits.toBoolArray();
      let offset = 0;
      for (let i = 0; i < committees.length; i++) {
        const committee = committees[i];
        const aggregationBits = BitArray.fromBoolArray(aggregationBools.slice(offset, offset + committee.length));
        const trueBitCount = aggregationBits.getTrueBitIndexes().length;
        offset += committee.length;
        this.seenAggregatedAttestations.add(
          target.epoch,
          committeeIndices[i],
          attDataRoot,
          {aggregationBits, trueBitCount},
          true
        );
      }
    }
  }

  discardVerifiedBlocks(blockRootHexes: string[]): void {
    for (const r of blockRootHexes) {
      this.verifiedBlocks.delete(r);
    }
  }

  // --- Fork-choice writes (routed here so the facade never writes fork choice directly) ---

  updateTime(currentSlot: Slot): void {
    this.forkChoice.updateTime(currentSlot);
  }

  getIrrecoverableError(): Error | undefined {
    return this.forkChoice.irrecoverableError;
  }

  validateLatestHash(execResponse: LVHExecResponse): void {
    this.forkChoice.validateLatestHash(execResponse);
  }

  // --- DB ownership (blocks + states) ---

  async migrateFinalized(finalized: CheckpointWithHex): Promise<MigrateFinalizedResult> {
    // Snapshot from the engine's own fork choice: canonical ancestors (newest→oldest, last = previous
    // finalized boundary) + non-canonical (orphaned) blocks. The facade cleans DA/light-client from this.
    const {ancestors, nonAncestors} = this.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(
      finalized.rootHex
    );
    const snapshot = {
      canonical: ancestors.map(toFinalizedProtoSummary),
      nonCanonical: nonAncestors.map(toFinalizedProtoSummary),
    };

    // 1. Migrate canonical blocks hot→cold + delete non-canonical blocks (blocks are engine-owned).
    let timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
    await migrateFinalizedBlocks(
      this.db,
      this.logger,
      ancestors,
      nonAncestors,
      finalized,
      this.clock.currentEpoch,
      this.opts.persistOrphanedBlocks,
      this.opts.persistOrphanedBlocksDir
    );
    // Migrate canonical payload envelopes hot→cold + delete non-canonical (envelopes are engine-owned,
    // consensus data — not DA). Tied to canonical blocks, so run right after block migration.
    await migrateFinalizedExecutionPayloadEnvelopes(
      this.config,
      this.db,
      this.logger,
      snapshot,
      finalized.epoch,
      this.clock.currentEpoch
    );
    timer?.({source: ArchiveStoreTask.ArchiveBlocks});

    // 2. Archive the finalized state (states are engine-owned). MUST run after block migration so a
    //    restart never sees an archived state whose canonical blocks are still only in hot db.
    timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
    await this.stateArchiveStrategy.maybeArchiveState(finalized, this.metrics);
    timer?.({source: ArchiveStoreTask.MaybeArchiveState});

    // 3. Prune fork choice (in-memory) after the DB writes committed.
    timer = this.metrics?.processFinalizedCheckpoint.durationByTask.startTimer();
    const prunedBlocks = this.forkChoice.prune(finalized.rootHex);
    timer?.({source: ArchiveStoreTask.ForkchoicePrune});

    return {snapshot, prunedBlocks};
  }

  async persistFinalizedStateToDisk(): Promise<void> {
    return this.stateArchiveStrategy.archiveState(this.forkChoice.getFinalizedCheckpoint());
  }

  async archiveStateOnCheckpoint(): Promise<void> {
    const headStateRoot = this.forkChoice.getHead().stateRoot;
    this.regen.pruneOnCheckpoint(
      this.forkChoice.getFinalizedCheckpoint().epoch,
      this.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );
    await this.stateArchiveStrategy.onCheckpoint(headStateRoot, this.metrics);
  }

  /** Prune finalized blocks + states below the retention window (engine-owned block/state DB). */
  async pruneHistory(finalizedEpoch: Epoch, currentEpoch: Epoch): Promise<void> {
    await pruneHistory(this.config, this.db, this.logger, this.metrics, finalizedEpoch, currentEpoch);
  }

  /** Populate the (engine-owned) op pool from its persisted DB repos. Call once on startup. */
  async loadOpPoolFromDisk(): Promise<void> {
    await this.opPool.fromPersisted(this.db);
  }

  /** Persist the (engine-owned) op pool to its DB repos. Call before stopping. */
  async persistOpPoolToDisk(): Promise<void> {
    await this.opPool.toPersisted(this.db);
  }

  // === BLK-3: state-read engine methods (regen-backed; no IBeaconStateView crosses the seam) ===

  /** Dump regen cache summary (lodestar debug endpoint). */
  dumpCacheSummary(): routes.lodestar.StateCacheItem[] {
    return this.regen.dumpCacheSummary();
  }

  /** Drop regen caches (lodestar debug endpoint). */
  dropCache(): void {
    this.regen.dropCache();
  }

  /** Snapshot of the regen job queue (lodestar debug endpoint). */
  dumpRegenQueueItems(): {key: RegenRequest["key"]; args: RegenRequest; addedTimeMs: number}[] {
    return this.regen.jobQueue.getItems().map((item) => ({
      key: item.args[0].key,
      args: item.args[0],
      addedTimeMs: item.addedTimeMs,
    }));
  }

  /** Active validator count of the head state (network init). */
  getActiveValidatorCount(): number {
    return this.getHeadState().activeValidatorCount;
  }

  /** Head-state electra queue counts (facade metrics); null pre-electra. */
  getHeadPendingCounts(): {
    pendingDeposits: number;
    pendingPartialWithdrawals: number;
    pendingConsolidations: number;
  } | null {
    const state = this.getHeadState();
    if (!isStatePostElectra(state)) {
      return null;
    }
    return {
      pendingDeposits: state.pendingDepositsCount,
      pendingPartialWithdrawals: state.pendingPartialWithdrawalsCount,
      pendingConsolidations: state.pendingConsolidationsCount,
    };
  }

  /** Validator-monitor end-of-epoch hook against the head state (facade clock listener drives the timing). */
  validatorMonitorOnceEveryEndOfEpoch(): void {
    this.validatorMonitor?.onceEveryEndOfEpoch(this.getHeadState());
  }

  /** Whether regen can accept more work (backpressure). */
  regenCanAcceptWork(): boolean {
    return this.regen.canAcceptWork();
  }

  /** Initialize regen caches from disk (startup). */
  async initRegen(): Promise<void> {
    await this.regen.init();
  }

  /** Head-state execution flags for the notifier (post-bellatrix merge-transition display). */
  getHeadExecutionStateInfo(): {isExecutionStateType: boolean; isMergeTransitionComplete: boolean} {
    const state = this.getHeadState();
    if (!isStatePostBellatrix(state) || !state.isExecutionStateType) {
      return {isExecutionStateType: false, isMergeTransitionComplete: false};
    }
    return {isExecutionStateType: true, isMergeTransitionComplete: state.isMergeTransitionComplete};
  }

  /** Build the historical-state worker if enabled (--serveHistoricalState). Idempotent; call on startup. */
  async loadHistoricalStateRegen(): Promise<void> {
    if (this.opts.serveHistoricalState && !this.historicalStateRegen) {
      this.historicalStateRegen = await HistoricalStateRegen.init({
        opts: {
          genesisTime: this.clock.genesisTime,
          dbLocation: this.dbName,
          nativeStateView: this.opts.nativeStateView ?? false,
        },
        config: this.config,
        metrics: this.metrics,
        logger: this.logger as LoggerNode,
        signal: this.signal,
      });
    }
  }

  /** Terminate the historical-state worker (graceful shutdown). */
  async closeHistoricalStateRegen(): Promise<void> {
    await this.historicalStateRegen?.close();
  }

  /** Prometheus metrics from the historical-state worker. */
  async scrapeHistoricalStateMetrics(): Promise<string> {
    return (await this.historicalStateRegen?.scrapeMetrics()) ?? "";
  }

  /** Serialized historical (below-finalized) state by slot; null if unavailable / not enabled. */
  async getHistoricalStateBySlot(
    slot: Slot
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.forkChoice.getFinalizedBlock();
    if (slot >= finalizedBlock.slot) {
      return null;
    }
    const stateSerialized = await this.historicalStateRegen?.getHistoricalState(slot);
    if (!stateSerialized) {
      return null;
    }
    return {state: stateSerialized, executionOptimistic: isOptimisticBlock(finalizedBlock), finalized: true};
  }

  // --- API state resolution (engine-internal; state never leaves the engine) ---

  /** Resolve an API stateId (already reduced to root/slot/checkpoint) to a state view or bytes. */
  private async resolveStateForApi(
    id: RootHex | Slot | CheckpointWithHex
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    if (typeof id === "string") {
      return this.getStateByStateRoot(id, {allowRegen: true});
    }
    if (typeof id === "number") {
      if (id > this.clock.currentSlot) {
        return null; // Don't try to serve future slots
      }
      return id >= this.getFinalizedBlock().slot
        ? this.getStateBySlot(id, {allowRegen: true})
        : this.getHistoricalStateBySlot(id);
    }
    return this.getStateOrBytesByCheckpoint(id);
  }

  /** Resolve to a state *view* (deserializing archive/checkpoint bytes engine-side onto the head state). */
  private async resolveStateViewForApi(
    id: RootHex | Slot | CheckpointWithHex
  ): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null> {
    const res = await this.resolveStateForApi(id);
    if (!res) {
      return null;
    }
    const state = res.state instanceof Uint8Array ? this.getHeadState().loadOtherState(res.state) : res.state;
    return {state, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
  }

  /** Serialized state for the debug `getStateV2` endpoint (the only whole-state-bytes crossing). */
  async getSerializedState(
    id: RootHex | Slot | CheckpointWithHex
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const res = await this.resolveStateForApi(id);
    if (!res) {
      return null;
    }
    const state = res.state instanceof Uint8Array ? res.state : res.state.serialize();
    return {state, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
  }

  /** Effective balances of `validatorIndices` from the finalized checkpoint state (custody group count). */
  async getFinalizedEffectiveBalances(
    finalizedCheckpoint: CheckpointWithHex,
    validatorIndices: ValidatorIndex[]
  ): Promise<number[] | null> {
    const stateOrBytes = (await this.getStateOrBytesByCheckpoint(finalizedCheckpoint))?.state;
    if (!stateOrBytes) {
      return null;
    }
    if (stateOrBytes instanceof Uint8Array) {
      return getEffectiveBalancesFromStateBytes(this.config, stateOrBytes, validatorIndices);
    }
    return validatorIndices.map((index) => stateOrBytes.getValidator(index).effectiveBalance ?? 0);
  }

  /** Multi-proof of the resolved state for the given SSZ `descriptor`; null if the state is unavailable. */
  async getStateProof(
    id: RootHex | Slot | CheckpointWithHex,
    descriptor: Uint8Array
  ): Promise<{proof: CompactMultiProof; fork: ForkName} | null> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) {
      return null;
    }
    return {proof: res.state.createMultiProof(descriptor), fork: this.config.getForkName(res.state.slot)};
  }

  /** Historical summaries + single-proof of the resolved state; null if unavailable (post-capella only). */
  async getHistoricalSummaries(id: RootHex | Slot | CheckpointWithHex): Promise<{
    slot: Slot;
    historicalSummaries: capella.HistoricalSummaries;
    proof: Uint8Array[];
    fork: ForkName;
    executionOptimistic: boolean;
    finalized: boolean;
  } | null> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) {
      return null;
    }
    const {state, executionOptimistic, finalized} = res;
    const fork = this.config.getForkName(state.slot);
    if (ForkSeq[fork] < ForkSeq.capella) {
      throw new Error("Historical summaries are not supported before Capella");
    }
    if (!isStatePostCapella(state)) {
      throw new Error("Expected Capella state for historical summaries");
    }
    const {gindex} = ssz[fork].BeaconState.getPathInfo(["historicalSummaries"]);
    return {
      slot: state.slot,
      historicalSummaries: state.historicalSummaries,
      proof: state.getSingleProof(gindex),
      fork,
      executionOptimistic,
      finalized,
    };
  }

  /** Resolve per-epoch shuffling and build indexed attestations (attester-slashing debug helper). */
  async getIndexedAttestationsForSlashing(
    requests: {slot: Slot; epoch: Epoch; attestations: Attestation[]}[],
    forkSeq: ForkSeq
  ): Promise<IndexedAttestation[]> {
    const indexed: IndexedAttestation[] = [];
    for (const {slot, epoch, attestations} of requests) {
      const res = await this.resolveStateViewForApi(slot);
      if (!res) {
        throw Error(`State not available for slot ${slot}`);
      }
      const shuffling = res.state.getShufflingAtEpoch(epoch);
      for (const attestation of attestations) {
        indexed.push(getIndexedAttestation(shuffling, forkSeq, attestation));
      }
    }
    return indexed;
  }

  // --- beacon/state API family (each resolves state internally, returns a targeted DTO) ---

  private toValidatorResponse(
    index: ValidatorIndex,
    validator: phase0.Validator,
    balance: number,
    currentEpoch: Epoch
  ): routes.beacon.ValidatorResponse {
    return {index, status: getValidatorStatus(validator, currentEpoch), balance, validator};
  }

  private resolveStateValidatorIndex(
    id: routes.beacon.ValidatorId | BLSPubkey,
    state: IBeaconStateView
  ): StateValidatorIndexResponse {
    return getStateValidatorIndex(id, state, this.pubkeyCache);
  }

  private filterStateValidatorsByStatus(
    statuses: string[],
    state: IBeaconStateView,
    currentEpoch: Epoch
  ): routes.beacon.ValidatorResponse[] {
    const responses: routes.beacon.ValidatorResponse[] = [];
    const validators = state.getValidatorsByStatus(new Set(statuses), currentEpoch);
    for (const validator of validators) {
      const resp = this.resolveStateValidatorIndex(validator.pubkey, state);
      if (resp.valid) {
        responses.push(
          this.toValidatorResponse(resp.validatorIndex, validator, state.getBalance(resp.validatorIndex), currentEpoch)
        );
      }
    }
    return responses;
  }

  async getStateRoot(id: RootHex | Slot | CheckpointWithHex): Promise<ApiStateResult<{root: Root}>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    return {
      data: {root: res.state.hashTreeRoot()},
      executionOptimistic: res.executionOptimistic,
      finalized: res.finalized,
    };
  }

  async getStateFork(id: RootHex | Slot | CheckpointWithHex): Promise<ApiStateResult<phase0.Fork>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    return {data: res.state.fork, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
  }

  async getStateRandao(
    id: RootHex | Slot | CheckpointWithHex,
    epoch?: Epoch
  ): Promise<ApiStateResult<{randao: Bytes32}>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const stateEpoch = computeEpochAtSlot(state.slot);
    const usedEpoch = epoch ?? stateEpoch;
    if (!(stateEpoch < usedEpoch + EPOCHS_PER_HISTORICAL_VECTOR && usedEpoch <= stateEpoch)) {
      return {invalid: {code: 400, message: "Requested epoch is out of range"}};
    }
    return {data: {randao: state.getRandaoMix(usedEpoch)}, executionOptimistic, finalized};
  }

  async getStateFinalityCheckpoints(id: RootHex | Slot | CheckpointWithHex): Promise<
    ApiStateResult<{
      currentJustified: phase0.Checkpoint;
      previousJustified: phase0.Checkpoint;
      finalized: phase0.Checkpoint;
    }>
  > {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    return {
      data: {
        currentJustified: state.currentJustifiedCheckpoint,
        previousJustified: state.previousJustifiedCheckpoint,
        finalized: state.finalizedCheckpoint,
      },
      executionOptimistic,
      finalized,
    };
  }

  async getStateValidators(
    id: RootHex | Slot | CheckpointWithHex,
    validatorIds: routes.beacon.ValidatorId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse[]>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const currentEpoch = getCurrentEpoch(state);

    let data: routes.beacon.ValidatorResponse[];
    if (validatorIds.length) {
      data = [];
      for (const vid of validatorIds) {
        const resp = this.resolveStateValidatorIndex(vid, state);
        if (resp.valid) {
          const validator = state.getValidator(resp.validatorIndex);
          if (statuses.length && !statuses.includes(getValidatorStatus(validator, currentEpoch))) {
            continue;
          }
          data.push(
            this.toValidatorResponse(
              resp.validatorIndex,
              validator,
              state.getBalance(resp.validatorIndex),
              currentEpoch
            )
          );
        }
      }
    } else if (statuses.length) {
      data = this.filterStateValidatorsByStatus(statuses, state, currentEpoch);
    } else {
      // TODO: This loops over the entire state, it's a DOS vector
      const validatorsArr = state.getAllValidators();
      const balancesArr = state.getAllBalances();
      data = [];
      for (let i = 0; i < validatorsArr.length; i++) {
        data.push(this.toValidatorResponse(i, validatorsArr[i], balancesArr[i], currentEpoch));
      }
    }
    return {data, executionOptimistic, finalized};
  }

  async getStateValidatorIdentities(
    id: RootHex | Slot | CheckpointWithHex,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorIdentities>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;

    let data: routes.beacon.ValidatorIdentities;
    if (validatorIds.length) {
      data = [];
      for (const vid of validatorIds) {
        const resp = this.resolveStateValidatorIndex(vid, state);
        if (resp.valid) {
          const {pubkey, activationEpoch} = state.getValidator(resp.validatorIndex);
          data.push({index: resp.validatorIndex, pubkey, activationEpoch});
        }
      }
    } else {
      const validatorsArr = state.getAllValidators();
      data = new Array(validatorsArr.length) as routes.beacon.ValidatorIdentities;
      for (let i = 0; i < validatorsArr.length; i++) {
        const {pubkey, activationEpoch} = validatorsArr[i];
        data[i] = {index: i, pubkey, activationEpoch};
      }
    }
    return {data, executionOptimistic, finalized};
  }

  async getStateValidator(
    id: RootHex | Slot | CheckpointWithHex,
    validatorId: routes.beacon.ValidatorId
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const resp = this.resolveStateValidatorIndex(validatorId, state);
    if (!resp.valid) {
      return {invalid: {code: resp.code, message: resp.reason}};
    }
    return {
      data: this.toValidatorResponse(
        resp.validatorIndex,
        state.getValidator(resp.validatorIndex),
        state.getBalance(resp.validatorIndex),
        getCurrentEpoch(state)
      ),
      executionOptimistic,
      finalized,
    };
  }

  async getStateValidatorBalances(
    id: RootHex | Slot | CheckpointWithHex,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorBalance[]>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;

    let data: routes.beacon.ValidatorBalance[];
    if (validatorIds.length) {
      data = [];
      for (const vid of validatorIds) {
        const resp = this.resolveStateValidatorIndex(vid, state);
        if (resp.valid) {
          data.push({index: resp.validatorIndex, balance: state.getBalance(resp.validatorIndex)});
        }
      }
    } else {
      // TODO: This loops over the entire state, it's a DOS vector
      const balancesArr = state.getAllBalances();
      data = [];
      for (let i = 0; i < balancesArr.length; i++) {
        data.push({index: i, balance: balancesArr[i]});
      }
    }
    return {data, executionOptimistic, finalized};
  }

  async getEpochCommittees(
    id: RootHex | Slot | CheckpointWithHex,
    filters: {epoch?: Epoch; index?: CommitteeIndex; slot?: Slot}
  ): Promise<ApiStateResult<routes.beacon.EpochCommitteeResponse[]>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;

    const stateEpoch = computeEpochAtSlot(state.slot);
    const epoch = filters.epoch ?? stateEpoch;
    const startSlot = computeStartSlotAtEpoch(epoch);
    const endSlot = startSlot + SLOTS_PER_EPOCH - 1;

    if (Math.abs(epoch - stateEpoch) > 1) {
      return {invalid: {code: 400, message: `Epoch ${epoch} must be within one epoch of state epoch ${stateEpoch}`}};
    }
    if (filters.slot !== undefined && (filters.slot < startSlot || filters.slot > endSlot)) {
      return {invalid: {code: 400, message: `Slot ${filters.slot} is not in epoch ${epoch}`}};
    }

    const decisionRoot = state.getShufflingDecisionRoot(epoch);
    const shuffling = await this.shufflingCache.get(epoch, decisionRoot);
    if (!shuffling) {
      return {
        invalid: {
          code: 500,
          message: `No shuffling found to calculate committees for epoch: ${epoch} and decisionRoot: ${decisionRoot}`,
        },
      };
    }
    const data = shuffling.committees.flatMap((slotCommittees, slotInEpoch) => {
      const slot = startSlot + slotInEpoch;
      if (filters.slot !== undefined && filters.slot !== slot) {
        return [];
      }
      return slotCommittees.flatMap((committee, committeeIndex) => {
        if (filters.index !== undefined && filters.index !== committeeIndex) {
          return [];
        }
        return [{index: committeeIndex, slot, validators: Array.from(committee)}];
      });
    });
    return {data, executionOptimistic, finalized};
  }

  async getEpochSyncCommittees(
    id: RootHex | Slot | CheckpointWithHex,
    epoch?: Epoch
  ): Promise<ApiStateResult<routes.beacon.EpochSyncCommitteeResponse>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;

    const stateEpoch = computeEpochAtSlot(state.slot);
    if (stateEpoch < this.config.ALTAIR_FORK_EPOCH) {
      return {invalid: {code: 400, message: "Requested state before ALTAIR_FORK_EPOCH"}};
    }
    if (!isStatePostAltair(state)) {
      throw new Error("Expected Altair state for sync committee lookup");
    }

    const syncCommitteeCache = state.getIndexedSyncCommitteeAtEpoch(epoch ?? stateEpoch);
    const validatorIndices = new Array<ValidatorIndex>(...syncCommitteeCache.validatorIndices);
    const validatorAggregates: ValidatorIndex[][] = [];
    for (let i = 0; i < validatorIndices.length; i += SYNC_COMMITTEE_SUBNET_SIZE) {
      validatorAggregates.push(validatorIndices.slice(i, i + SYNC_COMMITTEE_SUBNET_SIZE));
    }
    return {data: {validators: validatorIndices, validatorAggregates}, executionOptimistic, finalized};
  }

  async getStatePendingDeposits(
    id: RootHex | Slot | CheckpointWithHex,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingDeposits>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const fork = state.forkName;
    if (!isStatePostElectra(state)) {
      return {invalid: {code: 400, message: `Cannot retrieve pending deposits for pre-electra state fork=${fork}`}};
    }
    const data = returnBytes ? ssz.electra.PendingDeposits.serialize(state.pendingDeposits) : state.pendingDeposits;
    return {data, fork, executionOptimistic, finalized};
  }

  async getStatePendingPartialWithdrawals(
    id: RootHex | Slot | CheckpointWithHex,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingPartialWithdrawals>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const fork = state.forkName;
    if (!isStatePostElectra(state)) {
      return {
        invalid: {code: 400, message: `Cannot retrieve pending partial withdrawals for pre-electra state fork=${fork}`},
      };
    }
    const data = returnBytes
      ? ssz.electra.PendingPartialWithdrawals.serialize(state.pendingPartialWithdrawals)
      : state.pendingPartialWithdrawals;
    return {data, fork, executionOptimistic, finalized};
  }

  async getStatePendingConsolidations(
    id: RootHex | Slot | CheckpointWithHex,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingConsolidations>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const fork = state.forkName;
    if (!isStatePostElectra(state)) {
      return {
        invalid: {code: 400, message: `Cannot retrieve pending consolidations for pre-electra state fork=${fork}`},
      };
    }
    const data = returnBytes
      ? ssz.electra.PendingConsolidations.serialize(state.pendingConsolidations)
      : state.pendingConsolidations;
    return {data, fork, executionOptimistic, finalized};
  }

  async getStateProposerLookahead(
    id: RootHex | Slot | CheckpointWithHex,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | fulu.ProposerLookahead>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const fork = state.forkName;
    if (!isStatePostFulu(state)) {
      return {invalid: {code: 400, message: `Cannot retrieve proposer lookahead for pre-fulu state fork=${fork}`}};
    }
    const data = returnBytes ? ssz.fulu.ProposerLookahead.serialize(state.proposerLookahead) : state.proposerLookahead;
    return {data, fork, executionOptimistic, finalized};
  }

  private async getStateBySlot(
    slot: Slot,
    opts?: StateGetOpts
  ): Promise<{state: IBeaconStateView; executionOptimistic: boolean; finalized: boolean} | null> {
    const finalizedBlock = this.getFinalizedBlock();

    if (slot < finalizedBlock.slot) {
      // request for finalized state not supported here; caller falls back to getHistoricalStateBySlot
      return null;
    }

    if (opts?.allowRegen) {
      const block = this.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
      const state = await this.regen.getBlockSlotState(block, slot, {dontTransferCache: true}, RegenCaller.restApi);
      return {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      };
    }

    const block = this.getCanonicalProtoBlockAtSlot(slot);
    if (!block) {
      return null;
    }

    const state = this.regen.getStateSync(block.stateRoot);
    return (
      state && {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      }
    );
  }

  private async getStateByStateRoot(
    stateRoot: RootHex,
    opts?: StateGetOpts
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    if (opts?.allowRegen) {
      const state = await this.regen.getState(stateRoot, RegenCaller.restApi);
      const block = this.getBlockDefaultStatus(ssz.phase0.BeaconBlockHeader.hashTreeRoot(state.latestBlockHeader));
      const finalizedEpoch = this.getFinalizedCheckpoint().epoch;
      return {
        state,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: state.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    const cachedStateCtx = this.regen.getStateSync(stateRoot);
    if (cachedStateCtx) {
      const block = this.getBlockDefaultStatus(
        ssz.phase0.BeaconBlockHeader.hashTreeRoot(cachedStateCtx.latestBlockHeader)
      );
      const finalizedEpoch = this.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: cachedStateCtx.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    const data = await this.getSerializedStateByRoot(fromHex(stateRoot));
    return data && {state: data, executionOptimistic: false, finalized: true};
  }

  private async getStateOrBytesByCheckpoint(
    checkpoint: CheckpointWithHex
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    const checkpointHex = {epoch: checkpoint.epoch, rootHex: checkpoint.rootHex};
    const cachedStateCtx = await this.regen.getCheckpointStateOrBytes(checkpointHex);
    if (cachedStateCtx) {
      const block = this.getBlockDefaultStatus(checkpoint.root);
      const finalizedEpoch = this.getFinalizedCheckpoint().epoch;
      return {
        state: cachedStateCtx,
        executionOptimistic: block != null && isOptimisticBlock(block),
        finalized: checkpoint.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }

    return null;
  }

  /** Latest weak-subjectivity checkpoint epoch from the head state (lodestar debug). */
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    return this.getHeadState().getLatestWeakSubjectivityCheckpointEpoch();
  }

  /** Head-state `latestExecutionPayloadBid` (gloas empty-block detection in range sync); undefined pre-gloas. */
  getHeadLatestExecutionPayloadBid(): gloas.ExecutionPayloadBid | undefined {
    const state = this.getHeadState();
    return isStatePostGloas(state) ? (state as IBeaconStateViewGloas).latestExecutionPayloadBid : undefined;
  }

  /** Subset of `indices` that are active-or-pending at the current epoch (builder registration filter). */
  getActiveOrPendingValidators(indices: ValidatorIndex[]): Set<ValidatorIndex> {
    const state = this.getHeadState();
    const currentEpoch = this.clock.currentEpoch;
    const kept = new Set<ValidatorIndex>();
    for (const index of indices) {
      const status = getValidatorStatus(state.getValidator(index), currentEpoch);
      if (
        status === "active_exiting" ||
        status === "active_ongoing" ||
        status === "active_slashed" ||
        status === "pending_initialized" ||
        status === "pending_queued"
      ) {
        kept.add(index);
      }
    }
    return kept;
  }

  /**
   * Attestation `source` = the state's *realized* `currentJustifiedCheckpoint` in `attEpoch` (may regen
   * forward past head). Not fork-choice's justified checkpoint — the two diverge at an epoch boundary and
   * using fork-choice's would yield an invalid source.
   */
  async getAttestationSourceCheckpoint(attEpoch: Epoch): Promise<phase0.Checkpoint> {
    const state = await this.getHeadStateAtEpoch(attEpoch, RegenCaller.produceAttestationData);
    return state.currentJustifiedCheckpoint;
  }

  async getBlockRewards(block: BeaconBlock | BlindedBeaconBlock): Promise<rewards.BlockRewards> {
    let preState = this.regen.getPreStateSync(block);

    if (preState === null) {
      throw Error(`Pre-state is unavailable given block's parent root ${toRootHex(block.parentRoot)}`);
    }

    preState = preState.processSlots(block.slot); // Dial preState's slot to block.slot

    const proposerRewards = this.regen.getStateSync(toRootHex(block.stateRoot))?.proposerRewards ?? undefined;

    return preState.computeBlockRewards(block, proposerRewards);
  }

  async getAttestationsRewards(
    epoch: Epoch,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<{rewards: rewards.AttestationsRewards; executionOptimistic: boolean; finalized: boolean}> {
    // We use end slot of (epoch + 1) to ensure we have seen all attestations. On-time or late.
    const slot = computeEndSlotAtEpoch(epoch + 1);
    // No regen if state not in cache (mirrors former getStateBySlot({allowRegen: false})).
    const finalizedBlock = this.forkChoice.getFinalizedBlock();
    const block = slot < finalizedBlock.slot ? null : this.getCanonicalProtoBlockAtSlot(slot);
    const cachedState = block && this.regen.getStateSync(block.stateRoot);

    if (!block || !cachedState) {
      throw Error(`State is unavailable for slot ${slot}`);
    }

    const executionOptimistic = isOptimisticBlock(block);
    const finalized = slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT;
    const rewards = await cachedState.computeAttestationsRewards(validatorIds);

    return {rewards, executionOptimistic, finalized};
  }

  async getSyncCommitteeRewards(
    block: BeaconBlock | BlindedBeaconBlock,
    validatorIds?: (ValidatorIndex | string)[]
  ): Promise<rewards.SyncCommitteeRewards> {
    let preState = this.regen.getPreStateSync(block);

    if (preState === null) {
      throw Error(`Pre-state is unavailable given block's parent root ${toRootHex(block.parentRoot)}`);
    }

    preState = preState.processSlots(block.slot); // Dial preState's slot to block.slot
    if (!isStatePostAltair(preState)) {
      throw new Error("Sync committee rewards are not supported before Altair");
    }

    return preState.computeSyncCommitteeRewards(block, validatorIds ?? []);
  }

  // TODO - beacon engine: scalar state reads (getBeaconProposer, getValidator, getBalance,
  // getRandaoMix, getBlockRootAtSlot, getStateRootAtSlot, getShufflingDecisionRoot). Deferred —
  // signature shape (state vs stateRoot) to be decided alongside Phase 4 bytes-first.

  /**
   * `ForkChoice.onBlock` must never throw for a block that is valid with respect to the network
   * `justifiedBalancesGetter()` must never throw and it should always return a state.
   * @param blockState state that declares justified checkpoint `checkpoint`
   */
  private justifiedBalancesGetter(
    checkpoint: CheckpointWithHex,
    blockState: IBeaconStateView
  ): EffectiveBalanceIncrements {
    this.metrics?.balancesCache.requests.inc();

    const effectiveBalances = this.checkpointBalancesCache.get(checkpoint);
    if (effectiveBalances) {
      return effectiveBalances;
    }
    // not expected, need metrics
    this.metrics?.balancesCache.misses.inc();
    this.logger.debug("checkpointBalances cache miss", {
      epoch: checkpoint.epoch,
      root: checkpoint.rootHex,
    });

    const {state, stateId, shouldWarn} = this.closestJustifiedBalancesStateToCheckpoint(checkpoint, blockState);
    this.metrics?.balancesCache.closestStateResult.inc({stateId});
    if (shouldWarn) {
      this.logger.warn("currentJustifiedCheckpoint state not avail, using closest state", {
        checkpointEpoch: checkpoint.epoch,
        checkpointRoot: checkpoint.rootHex,
        stateId,
        stateSlot: state.slot,
        stateRoot: toRootHex(state.hashTreeRoot()),
      });
    }

    return state.getEffectiveBalanceIncrementsZeroInactive();
  }

  /**
   * - Assumptions + invariant this function is based on:
   * - Our cache can only persist X states at once to prevent OOM
   * - Some old states (including to-be justified checkpoint) may / must be dropped from the cache
   * - Thus, there is no guarantee that the state for a justified checkpoint will be available in the cache
   * @param blockState state that declares justified checkpoint `checkpoint`
   */
  private closestJustifiedBalancesStateToCheckpoint(
    checkpoint: CheckpointWithHex,
    blockState: IBeaconStateView
  ): {state: IBeaconStateView; stateId: string; shouldWarn: boolean} {
    const checkpointHex = {epoch: checkpoint.epoch, rootHex: checkpoint.rootHex};
    const state = this.regen.getCheckpointStateSync(checkpointHex);
    if (state) {
      return {state, stateId: "checkpoint_state", shouldWarn: false};
    }

    // Check if blockState is in the same epoch, not need to iterate the fork-choice then
    if (computeEpochAtSlot(blockState.slot) === checkpoint.epoch) {
      return {state: blockState, stateId: "block_state_same_epoch", shouldWarn: true};
    }

    // Find a state in the same branch of checkpoint at same epoch. Balances should exactly the same
    for (const descendantBlock of this.forkChoice.forwardIterateDescendantsDefaultStatus(checkpoint.rootHex)) {
      if (computeEpochAtSlot(descendantBlock.slot) === checkpoint.epoch) {
        const descendantBlockState = this.regen.getStateSync(descendantBlock.stateRoot);
        if (descendantBlockState) {
          return {state: descendantBlockState, stateId: "descendant_state_same_epoch", shouldWarn: true};
        }
      }
    }

    // Check if blockState is in the next epoch, not need to iterate the fork-choice then
    if (computeEpochAtSlot(blockState.slot) === checkpoint.epoch + 1) {
      return {state: blockState, stateId: "block_state_next_epoch", shouldWarn: true};
    }

    // Find a state in the same branch of checkpoint at a latter epoch. Balances are not the same, but should be close
    // Note: must call .forwardIterateDescendants() again since nodes are not sorted
    for (const descendantBlock of this.forkChoice.forwardIterateDescendantsDefaultStatus(checkpoint.rootHex)) {
      if (computeEpochAtSlot(descendantBlock.slot) > checkpoint.epoch) {
        const descendantBlockState = this.regen.getStateSync(descendantBlock.stateRoot);
        if (descendantBlockState) {
          return {state: blockState, stateId: "descendant_state_latter_epoch", shouldWarn: true};
        }
      }
    }

    // If there's no state available in the same branch of checkpoint use blockState regardless of its epoch
    return {state: blockState, stateId: "block_state_any_epoch", shouldWarn: true};
  }
}

/** Reduce a ProtoBlock to the plain scalars the facade needs for DA/light-client cleanup. */
function toFinalizedProtoSummary(block: ProtoBlock): FinalizedProtoSummary {
  return {slot: block.slot, blockRoot: block.blockRoot, payloadStatus: block.payloadStatus};
}

export type StateValidatorIndexResponse =
  | {valid: true; validatorIndex: ValidatorIndex}
  | {valid: false; code: number; reason: string};

/** Resolve a validator id (index | index-string | pubkey hex | pubkey bytes) to its index in `state`. */
export function getStateValidatorIndex(
  id: routes.beacon.ValidatorId | BLSPubkey,
  state: IBeaconStateView,
  pubkeyCache: PubkeyCache
): StateValidatorIndexResponse {
  if (typeof id === "string") {
    if (id.startsWith("0x")) {
      try {
        id = fromHex(id);
      } catch (_e) {
        return {valid: false, code: 400, reason: "Invalid pubkey hex encoding"};
      }
    } else {
      id = Number(id);
    }
  }

  if (typeof id === "number") {
    const validatorIndex = id;
    if (!Number.isSafeInteger(validatorIndex)) {
      return {valid: false, code: 400, reason: "Invalid validator index"};
    }
    if (validatorIndex >= state.validatorCount) {
      return {valid: false, code: 404, reason: "Validator index from future state"};
    }
    return {valid: true, validatorIndex};
  }

  const validatorIndex = pubkeyCache.getIndex(id);
  if (validatorIndex === null) {
    return {valid: false, code: 404, reason: "Validator pubkey not found in state"};
  }
  if (validatorIndex >= state.validatorCount) {
    return {valid: false, code: 404, reason: "Validator pubkey from future state"};
  }
  return {valid: true, validatorIndex};
}
