import {
  registerLocalValidator as registerNativeLocalValidator,
  unregisterLocalValidator as unregisterNativeLocalValidator,
} from "@chainsafe/lodestar-z/metrics";
import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {
  CheckpointWithHex,
  EpochDifference,
  ForkChoiceStateGetter,
  IForkChoice,
  PayloadStatus,
  ProtoBlock,
  ProtoNode,
  UpdateHeadOpt,
} from "@lodestar/fork-choice";
import type {LoggerNode} from "@lodestar/logger/node";
import {
  ForkName,
  ForkPostGloas,
  ForkSeq,
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SYNC_COMMITTEE_SUBNET_SIZE,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  EffectiveBalanceIncrements,
  EpochShuffling,
  IBeaconStateView,
  IBeaconStateViewGloas,
  calculateCommitteeAssignments,
  computeEndSlotAtEpoch,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createBeaconStateView,
  isStatePostAltair,
  isStatePostBellatrix,
  isStatePostElectra,
  isStatePostGloas,
  proposerShufflingDecisionRoot,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BLSSignature,
  BeaconBlock,
  BlindedBeaconBlock,
  Bytes32,
  CommitteeIndex,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
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
  phase0,
  rewards,
  ssz,
} from "@lodestar/types";
import {
  LodestarError,
  Logger,
  byteArrayEquals,
  fromHex,
  isErrorAborted,
  pruneSetToMax,
  sleep,
  toRootHex,
} from "@lodestar/utils";
import {ApiError, NodeIsSyncing} from "../../api/impl/errors.js";
import {ZERO_HASH} from "../../constants/index.js";
import {IBeaconEngineDb} from "../../db/index.js";
import {decodeArchivedEnvelope} from "../../db/repositories/index.js";
import {BuilderApiClient} from "../../execution/builder/apiClient.js";
import {BuilderStatus} from "../../execution/builder/http.js";
import {IExecutionBuilder, IExecutionEngine} from "../../execution/index.js";
import {Metrics, RegistryMetricCreator} from "../../metrics/index.js";
import {CommitteeSubscription} from "../../network/subnets/interface.js";
import {BufferPool} from "../../util/bufferPool.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";
import {HistoricalStateRegen} from "../archiveStore/historicalState/historicalStateRegen.js";
import {ArchiveMode, StateArchiveStrategy} from "../archiveStore/interface.js";
import {FrequencyStateArchiveStrategy} from "../archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {CheckpointBalancesCache} from "../balancesCache.js";
import {BeaconProposerCache, ProposerPreparationData} from "../beaconProposerCache.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadEnvelopeInputSource, SourceMeta} from "../blocks/payloadEnvelopeInput/types.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {SegmentExecStatus} from "../blocks/verifyBlocksExecutionPayloads.js";
import {verifyExecutionPayloadEnvelope as verifyEnvelopeFields} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {BuilderCircuitBreaker} from "../builderCircuitBreaker.js";
import {ChainViewSnapshot, FinalizedProtoSummary} from "../chainView/interface.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {BlockErrorCode} from "../errors/index.js";
import {ForkchoiceCaller, initializeForkChoice} from "../forkChoice/index.js";
import {persistAnchorState} from "../initState.js";
import {CommonBlockBody, FindHeadFnName} from "../interface.js";
import {LightClientServer} from "../lightClient/index.js";
import {
  AggregatedAttestationPool,
  AttestationPool,
  DeferredVoluntaryExitPool,
  ExecutionPayloadBidPool,
  OpPool,
  PayloadAttestationPool,
  ProposerPreferencesPool,
  SyncCommitteeMessagePool,
  SyncContributionAndProofPool,
} from "../opPools/index.js";
import {InsertOutcome} from "../opPools/types.js";
import {BlockProcessOpts} from "../options.js";
import {BlockAttributes, BlockType} from "../produceBlock/produceBlockBody.js";
import {QueuedStateRegenerator, RegenCaller, RegenRequest} from "../regen/index.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenExecutionPayloadBids,
  SeenPayloadAttesters,
  SeenSyncCommitteeMessages,
} from "../seenCache/index.js";
import {SeenAggregatedAttestations} from "../seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "../seenCache/seenAttestationData.js";
import {SeenBlockAttesters} from "../seenCache/seenBlockAttesters.js";
import {ShufflingCache} from "../shufflingCache.js";
import {FIFOBlockStateCache} from "../stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache} from "../stateCache/persistentCheckpointsCache.js";
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
import {GossipBlockValidationResult, validateGossipBlock, verifyBlockProposerSignature} from "../validation/block.js";
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
import type {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
import {validateApiVoluntaryExit, validateGossipVoluntaryExit} from "../validation/voluntaryExit.js";
import {
  OpSource,
  ValidatorMonitor,
  ValidatorMonitorAttestation,
  ValidatorMonitorBlock,
  createValidatorMonitor,
} from "../validatorMonitor.js";
import {AggregatorTracker} from "./aggregatorTracker.js";
import {
  getBuilderPendingPayments,
  getBuilderPendingWithdrawals,
  getEpochCommittees,
  getEpochSyncCommittees,
  getFinalizedEffectiveBalances,
  getHistoricalSummaries,
  getIndexedAttestationsForSlashing,
  getSerializedState,
  getStateBuilders,
  getStateFinalityCheckpoints,
  getStateFork,
  getStatePendingConsolidations,
  getStatePendingDeposits,
  getStatePendingPartialWithdrawals,
  getStateProof,
  getStateProposerLookahead,
  getStatePtc,
  getStateRandao,
  getStateRoot,
  getStateValidator,
  getStateValidatorBalances,
  getStateValidatorIdentities,
  getStateValidators,
} from "./beaconApis.js";
import {ChainViewPublisher} from "./chainView.js";
import {getPubkeysForIndices} from "./duties.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "./events.js";
import {
  GossipValidationResult,
  GossipValidationStatus,
  fromResult,
  runGossipValidation,
} from "./gossipValidationResult.js";
import {VerifiedBlockBundle, importBlock} from "./importBlock.js";
import {importExecutionPayload} from "./importExecutionPayload.js";
import {AnchorSummary, EngineBootstrap} from "./initialization.js";
import type {ApiStateId} from "./interface.js";
import {
  ApiStateResult,
  ApiStateResultWithFork,
  BeaconEngineErrorCode,
  BeaconEngineModules,
  IBeaconEngine,
  ImportBlockResult,
  ImportExecutionPayloadOpts,
  PrepareNextSlotResponse,
  ProduceBlockRequest,
  ProduceBlockResponse,
  ProduceBlockV4Request,
  ProduceBlockV4Response,
} from "./interface.js";
import {IBeaconEngineOptions} from "./options.js";
import {prepareForNextSlot} from "./prepareNextSlot.js";
import {
  completeFinalization,
  deleteNonCanonicalBlocks,
  deleteNonCanonicalExecutionPayloadEnvelopes,
  migrateBlocksFromHotToColdDb,
  migrateExecutionPayloadEnvelopes,
  persistOrphanedBlocks,
  pruneHistory,
} from "./processFinalizedCheckpoint.js";
import {produceBlockWrapper, produceCommonBlockBody} from "./produceBlock.js";
import {produceBlockV4, produceEngineOrBuilderBlock} from "./produceEngineOrBuilderBlock.js";
import {SeenEnginePayloadEnvelopeInput} from "./seenEnginePayloadEnvelopeInput.js";
import {verifyBlocks} from "./verifyBlock.js";

const MAX_VERIFIED_PROPOSER_SIGNATURES = 3 * SLOTS_PER_EPOCH;

/** Owns consensus state. Anchor preparation precedes validation and runtime initialization. */
export class BeaconEngine implements IBeaconEngine {
  private readonly aggregatorTracker = new AggregatorTracker();
  readonly config: BeaconConfig;
  readonly opts: IBeaconEngineOptions;
  readonly logger: Logger;
  readonly metrics: Metrics | null;
  readonly clock: IClock;
  genesisTime!: number;
  readonly pubkeyCache: PubkeyCache;
  // NodeJS-specific memory pool for state serialization; engine-internal (not on IBeaconEngine).
  bufferPool!: BufferPool;
  bls!: IBlsVerifier;
  shufflingCache!: ShufflingCache;

  blockStateCache!: BlockStateCache;
  checkpointStateCache!: CheckpointStateCache;
  checkpointBalancesCache!: CheckpointBalancesCache;
  readonly events = new BeaconEngineEventBus();
  private chainViewPublisher?: ChainViewPublisher;
  private reportedIrrecoverableError?: Error;

  getChainViewSnapshot(): ChainViewSnapshot {
    this.chainViewPublisher ??= new ChainViewPublisher(this.forkChoice);
    return this.chainViewPublisher.snapshot();
  }

  // TODO - beacon engine: need to review this
  // the update could be too much
  // we can just update on import block/payload
  publishChainView(blocksChanged = true): void {
    const error = this.forkChoice.irrecoverableError;
    if (error && error !== this.reportedIrrecoverableError) {
      this.reportedIrrecoverableError = error;
      this.events.emit(BeaconEngineEvent.fatalError, error);
    }
    const update = this.chainViewPublisher?.update(blocksChanged);
    if (update) this.events.emit(BeaconEngineEvent.chainViewUpdated, update);
  }

  forkChoice!: IForkChoice;
  regen!: QueuedStateRegenerator;

  // Op pools
  attestationPool!: AttestationPool;
  aggregatedAttestationPool!: AggregatedAttestationPool;
  syncCommitteeMessagePool!: SyncCommitteeMessagePool;
  syncContributionAndProofPool!: SyncContributionAndProofPool;
  payloadAttestationPool!: PayloadAttestationPool;
  readonly executionPayloadBidPool = new ExecutionPayloadBidPool();
  readonly proposerPreferencesPool = new ProposerPreferencesPool();
  opPool!: OpPool;
  beaconProposerCache!: BeaconProposerCache;

  // Consensus gossip seen-caches
  seenPayloadEnvelopeInputCache!: SeenEnginePayloadEnvelopeInput;
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenPayloadAttesters = new SeenPayloadAttesters();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  seenContributionAndProof!: SeenContributionAndProof;
  seenAttestationDatas!: SeenAttestationDatas;
  readonly seenBlockProposers = new SeenBlockProposers();
  // Liveness cache: attesters seen through imported blocks (populated during block import).
  readonly seenBlockAttesters = new SeenBlockAttesters();
  seenAggregatedAttestations!: SeenAggregatedAttestations;
  readonly seenExecutionPayloadBids = new SeenExecutionPayloadBids();

  private readonly verifiedProposerSignatures = new Map<RootHex, BLSSignature>();
  validatorMonitor: ValidatorMonitor | null = null;
  private validatorMonitorMetrics: RegistryMetricCreator | null = null;
  private validatorMonitorTimeout?: ReturnType<typeof setTimeout>;
  private readonly onValidatorMonitorAbort = (): void => {
    clearTimeout(this.validatorMonitorTimeout);
    this.validatorMonitorTimeout = undefined;
  };
  // Engine owns envelope writes; the facade retains direct DB reads for API/reqresp serving.
  readonly db: IBeaconEngineDb;
  // Engine owns state archival (states DB). Finalized-state archive runs inside migrateFinalized; the
  // facade delegates temp-state (onCheckpoint) and shutdown persistence to engine methods.
  private stateArchiveStrategy!: StateArchiveStrategy;
  // Finalized writes are monotonic; restart from zero to include the newly persisted anchor.
  private statePruneFromSlot: Slot = 0;
  // Historical (below-finalized) state serving via a worker thread; built lazily on --serveHistoricalState.
  private historicalStateRegen?: HistoricalStateRegen;
  private readonly dbName: string;
  private readonly dataColumnDir: string;
  // TODO - beacon engine: internal helper context; keep this off the worker-facing interface.
  readonly signal: AbortSignal;
  lightClientServer: LightClientServer | undefined;
  readonly verifiedBlocks = new Map<string, VerifiedBlockBundle>();
  // TODO - beacon engine: this is not part of BeaconEngine but BeaconChain, remove it, create BeaconEngine own emitter if needed
  readonly emitter: ChainEventEmitter;
  // Genesis block root is invariant; computed lazily from state for the genesis-shuffling duty fallback.
  private cachedGenesisBlockRoot: Root | null = null;

  readonly executionEngine: IExecutionEngine;
  builderApiClient!: BuilderApiClient;
  builderCircuitBreaker!: BuilderCircuitBreaker;
  readonly deferredVoluntaryExitPool: DeferredVoluntaryExitPool;
  private readonly producingProposerSlashing = new Set<ValidatorIndex>();
  readonly executionBuilder?: IExecutionBuilder;

  private startupPhase:
    | "created"
    | "preparing"
    | "prepared"
    | "persisting"
    | "initializing"
    | "ready"
    | "failed"
    | "closed" = "created";
  private closed = false;
  private pendingPersistence?: Promise<void>;
  private anchorState?: IBeaconStateView;
  private anchorStateBytes?: Uint8Array;

  constructor(private readonly modules: BeaconEngineModules) {
    const {opts, config, logger, metrics, clock, pubkeyCache, signal, db} = modules;
    this.executionEngine = modules.executionEngine;
    this.executionBuilder = modules.executionBuilder;
    this.config = config;
    this.opts = opts;
    this.logger = logger;
    this.db = db;
    this.dbName = modules.dbName;
    this.dataColumnDir = modules.dataColumnDir;
    this.signal = signal;
    this.metrics = metrics;
    this.clock = clock;
    this.deferredVoluntaryExitPool = new DeferredVoluntaryExitPool(logger);
    this.pubkeyCache = pubkeyCache;
    this.emitter = modules.emitter;
  }

  async prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary> {
    this.assertStartupPhase("created");
    this.startupPhase = "preparing";
    try {
      const state = createBeaconStateView({
        config: this.config,
        stateBytes,
        nativeStateTransition: this.opts.nativeStateTransition ?? false,
      });
      const anchor = {
        slot: state.slot,
        stateRoot: state.hashTreeRoot(),
        fork: state.fork,
        checkpoint: state.computeAnchorCheckpoint().checkpoint,
        latestBlockSlot: state.latestBlockHeader.slot,
      };
      this.genesisTime = state.genesisTime;
      this.anchorState = state;
      this.anchorStateBytes = stateBytes;
      this.startupPhase = "prepared";
      return structuredClone(anchor);
    } catch (e) {
      this.startupPhase = "failed";
      throw e;
    }
  }

  async persistAnchorState(): Promise<void> {
    this.assertStartupPhase("prepared");
    const state = this.anchorState;
    const bytes = this.anchorStateBytes;
    if (!state || !bytes) throw new LodestarError({code: "ANCHOR_STATE_MISSING"});
    this.startupPhase = "persisting";
    try {
      this.pendingPersistence = persistAnchorState(this.config, this.db, state, bytes);
      await this.pendingPersistence;
      this.startupPhase = "prepared";
    } catch (e) {
      this.startupPhase = "failed";
      throw e;
    }
  }

  async initializeFromAnchor(): Promise<EngineBootstrap> {
    this.assertStartupPhase("prepared");
    const anchorState = this.anchorState;
    if (!anchorState) throw new LodestarError({code: "ANCHOR_STATE_MISSING"});
    this.startupPhase = "initializing";
    try {
      this.initializeRuntime(anchorState);
      const bootstrap: EngineBootstrap = {
        slot: anchorState.slot,
        stateRoot: anchorState.hashTreeRoot(),
        fork: anchorState.fork,
        checkpoint: anchorState.computeAnchorCheckpoint().checkpoint,
        latestBlockSlot: anchorState.latestBlockHeader.slot,
        genesisTime: anchorState.genesisTime,
        genesisValidatorsRoot: anchorState.genesisValidatorsRoot,
        previousJustifiedCheckpoint: ssz.phase0.Checkpoint.clone(anchorState.previousJustifiedCheckpoint),
        currentJustifiedCheckpoint: ssz.phase0.Checkpoint.clone(anchorState.currentJustifiedCheckpoint),
        finalizedCheckpoint: ssz.phase0.Checkpoint.clone(anchorState.finalizedCheckpoint),
        gloasAnchor:
          isStatePostGloas(anchorState) && anchorState.latestBlockHeader.slot > 0
            ? {
                fork: anchorState.forkName,
                proposerIndex: anchorState.latestBlockHeader.proposerIndex,
                bid: ssz.gloas.ExecutionPayloadBid.clone(anchorState.latestExecutionPayloadBid),
              }
            : null,
      };
      this.anchorState = undefined;
      this.anchorStateBytes = undefined;
      this.startupPhase = "ready";
      return structuredClone(bootstrap);
    } catch (e) {
      this.startupPhase = "failed";
      throw e;
    }
  }

  private assertStartupPhase(expected: "created" | "prepared"): void {
    if (this.closed || this.startupPhase !== expected) {
      throw new LodestarError({
        code: "BEACON_ENGINE_STARTUP_PHASE",
        expected,
        actual: this.closed ? "closed" : this.startupPhase,
      });
    }
  }

  private onSlot?: (slot: Slot) => void;
  private onEpoch?: (epoch: Epoch) => void;
  private readonly checkpointListener = this.onCheckpoint.bind(this);

  private initializeRuntime(anchorState: IBeaconStateView): void {
    const modules = this.modules;
    const {
      opts,
      config,
      logger,
      metrics,
      clock,
      cpStateDatastore,
      emitter,
      signal,
      db,
      validatorMonitorOpts,
      isAnchorStateFinalized,
    } = modules;
    // Source: unstable@0edec865c8 node/nodejs.ts#init. The monitor and registry stay with engine state.
    if (validatorMonitorOpts !== null) {
      this.validatorMonitorMetrics = metrics ? new RegistryMetricCreator() : null;
      this.validatorMonitor = createValidatorMonitor(
        this.validatorMonitorMetrics,
        config,
        anchorState.genesisTime,
        modules.validatorMonitorLogger ?? logger,
        validatorMonitorOpts,
        opts.nativeStateTransition
          ? {
              registerLocalValidator: registerNativeLocalValidator,
              unregisterLocalValidator: unregisterNativeLocalValidator,
            }
          : null
      );
    }
    // Engine owns the buffer pool; sized from the anchor state (NodeJS-specific, engine-internal).
    this.bufferPool = new BufferPool(anchorState.serializedSize(), metrics);
    this.lightClientServer = modules.lightClientServer;

    // by default, verify signatures on both main threads and worker threads
    this.bls = opts.blsVerifyAllMainThread
      ? new BlsSingleThreadVerifier({metrics})
      : new BlsMultiThreadWorkerPool(opts, {logger, metrics});

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

    this.seenPayloadEnvelopeInputCache = new SeenEnginePayloadEnvelopeInput({config, forkChoice: this.forkChoice, db});
    if (isStatePostGloas(anchorState) && anchorState.latestBlockHeader.slot > 0) {
      this.seenPayloadEnvelopeInputCache.addFromBid({
        blockRootHex: toRootHex(checkpoint.root),
        slot: anchorState.latestBlockHeader.slot,
        forkName: anchorState.forkName,
        proposerIndex: anchorState.latestBlockHeader.proposerIndex,
        bid: ssz.gloas.ExecutionPayloadBid.clone(anchorState.latestExecutionPayloadBid),
      });
    }

    this.regen = new QueuedStateRegenerator({
      config,
      forkChoice: this.forkChoice,
      blockStateCache: this.blockStateCache,
      checkpointStateCache: this.checkpointStateCache,
      db,
      metrics,
      validatorMonitor: this.validatorMonitor,
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
    this.onSlot = (slot: Slot) => {
      this.attestationPool.prune(slot);
      this.aggregatedAttestationPool.prune(slot);
      this.syncCommitteeMessagePool.prune(slot);
      this.payloadAttestationPool.prune(slot);
      this.executionPayloadBidPool.prune(slot);

      this.proposerPreferencesPool.prune(slot);
      this.seenSyncCommitteeMessages.prune(slot);
      this.seenExecutionPayloadBids.prune(slot);
      this.seenAttestationDatas.onSlot(slot);

      // Source: unstable@0edec865c8 chain/chain.ts#onClockSlot.
      if (metrics && (slot + 1) % SLOTS_PER_EPOCH === 0 && !this.closed && !this.signal.aborted) {
        clearTimeout(this.validatorMonitorTimeout);
        this.validatorMonitorTimeout = setTimeout(() => {
          this.validatorMonitorTimeout = undefined;
          try {
            this.validatorMonitor?.onceEveryEndOfEpoch(this.getHeadState());
          } catch (e) {
            if (!isErrorAborted(e))
              this.logger.error("Error on validator monitor onceEveryEndOfEpoch", {slot}, e as Error);
          }
        }, this.config.SLOT_DURATION_MS / 2);
      }
    };
    this.onEpoch = (epoch: Epoch) => {
      this.seenAttesters.prune(epoch);
      this.seenAggregators.prune(epoch);
      this.seenPayloadAttesters.prune(epoch);
      this.seenAggregatedAttestations.prune(epoch);
      this.seenBlockAttesters.prune(epoch);
      this.beaconProposerCache.prune(epoch);
    };
    this.clock.on(ClockEvent.slot, this.onSlot);
    this.clock.on(ClockEvent.epoch, this.onEpoch);
    this.signal.addEventListener("abort", this.onValidatorMonitorAbort, {once: true});
    this.emitter.on(ChainEvent.checkpoint, this.checkpointListener);

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

    this.builderCircuitBreaker = new BuilderCircuitBreaker(this.opts, {
      forkChoice: this.forkChoice,
      logger: this.logger,
      metrics: this.metrics,
    });
    // TODO - beacon engine (codex_beacon_engine_worker.md Task 10): replace shared JS services at the worker boundary.
    this.builderApiClient = new BuilderApiClient(
      modules.builderApiClientOpts ?? {},
      this.config,
      this.clock,
      this.bls,
      this.metrics,
      this.logger
    );
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

  /**
   * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#getProposerHead.
   * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
   */
  getProposerHead(slot: Slot): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: FindHeadFnName.getProposerHead});
    const secFromSlot = this.clock.secFromSlot(slot);

    try {
      // Do not emit head event here, when proposing we rely on the one emitted when importing our own block
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
      this.publishChainView(false);
      timer?.();
    }
  }

  // Developer API diagnostics only. Operational reads belong to BeaconChain.
  getHeads(): ProtoBlock[] {
    return this.forkChoice.getHeads();
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
  getFastConfirmationStore(): ReturnType<IBeaconEngine["getFastConfirmationStore"]> {
    return this.forkChoice.getFastConfirmationStore();
  }
  getConfirmedBlock(): ProtoBlock | null {
    return this.forkChoice.getConfirmedBlock();
  }
  getAllNodes(): ProtoNode[] {
    return this.forkChoice.getAllNodes();
  }

  pauseFastConfirmation(): void {
    this.forkChoice.pauseFastConfirmation();
  }

  resumeFastConfirmation(): void {
    this.forkChoice.resumeFastConfirmation();
  }
  // --- Internal block DB read for op-pool pruning. ---

  private async getSerializedBlockByRoot(
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

  // --- Cold block archive writes (backfill; engine-owned). Bytes-first + root/parent indexes. ---

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

  /** Serialized state by state root (cold archive). */
  async getSerializedStateByRoot(stateRoot: Uint8Array): Promise<Uint8Array | null> {
    return (await this.db.stateArchive.getBinaryByRoot(stateRoot)) ?? null;
  }

  /**
   * Source: unstable@1bf214377e chain/chain.ts#getParentExecutionRequests.
   * [beacon-engine] Read persisted envelopes directly; header archives retain requests without EL reconstruction.
   */
  async getParentExecutionRequests(
    parentBlockSlot: Slot,
    parentBlockRootHex: RootHex
  ): Promise<gloas.ExecutionRequests> {
    if (!isForkPostGloas(this.config.getForkName(parentBlockSlot))) {
      return ssz.gloas.ExecutionRequests.defaultValue();
    }
    const envelope = await this.db.executionPayloadEnvelope.get(fromHex(parentBlockRootHex));
    if (envelope !== null) return envelope.message.executionRequests;

    const bytes = await this.db.executionPayloadEnvelopeArchive.getBinary(parentBlockSlot);
    if (bytes !== null) {
      const archived = decodeArchivedEnvelope(bytes);
      const envelope =
        archived.headerEnvelope ?? ssz.gloas.SignedExecutionPayloadEnvelope.deserialize(archived.envelopeBytes);
      if (toRootHex(envelope.message.beaconBlockRoot) === parentBlockRootHex) {
        return envelope.message.executionRequests;
      }
    }
    throw Error(`Parent execution payload envelope not found slot=${parentBlockSlot}, root=${parentBlockRootHex}`);
  }

  produceCommonBlockBody(attrs: BlockAttributes): Promise<CommonBlockBody> {
    return produceCommonBlockBody.call(this, attrs);
  }

  produceBlockWrapper<T extends BlockType>(
    blockType: T,
    attrs: BlockAttributes & {commonBlockBodyPromise: Promise<CommonBlockBody>}
  ) {
    return (produceBlockWrapper<T>).call(this, blockType, attrs);
  }

  /** Runs inside BeaconEngine. Single V3 production entry and plain-data error boundary. */
  async produceBlock(request: ProduceBlockRequest): Promise<ProduceBlockResponse> {
    try {
      const {slot, randaoReveal, graffiti, builderBoostFactor, ...opts} = request;
      return {
        ok: true,
        data: await produceEngineOrBuilderBlock.call(this, slot, randaoReveal, graffiti, builderBoostFactor, opts),
      };
    } catch (e) {
      if (e instanceof NodeIsSyncing)
        return {
          ok: false,
          code: BeaconEngineErrorCode.NODE_SYNCING,
          payload: {message: e.message.replace(/^Node is syncing - /, "")},
        };
      if (e instanceof ApiError)
        return {ok: false, code: BeaconEngineErrorCode.API_ERROR, payload: {status: e.statusCode, message: e.message}};
      return {
        ok: false,
        code:
          isErrorAborted(e) || isQueueErrorAborted(e) ? BeaconEngineErrorCode.ABORTED : BeaconEngineErrorCode.INTERNAL,
        payload: {message: e instanceof Error ? e.message : String(e)},
      };
    }
  }

  /** Runs inside BeaconEngine. Single Gloas V4 production entry and plain-data error boundary. */
  async produceBlockV4(request: ProduceBlockV4Request): Promise<ProduceBlockV4Response> {
    try {
      return {ok: true, data: await produceBlockV4.call(this, request)};
    } catch (e) {
      if (e instanceof NodeIsSyncing)
        return {
          ok: false,
          code: BeaconEngineErrorCode.NODE_SYNCING,
          payload: {message: e.message.replace(/^Node is syncing - /, "")},
        };
      if (e instanceof ApiError)
        return {ok: false, code: BeaconEngineErrorCode.API_ERROR, payload: {status: e.statusCode, message: e.message}};
      return {
        ok: false,
        code:
          isErrorAborted(e) || isQueueErrorAborted(e) ? BeaconEngineErrorCode.ABORTED : BeaconEngineErrorCode.INTERNAL,
        payload: {message: e instanceof Error ? e.message : String(e)},
      };
    }
  }

  /**
   * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#updateBuilderStatus.
   * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
   */
  updateBuilderStatus(clockSlot: Slot): void {
    const executionBuilder = this.executionBuilder;
    if (executionBuilder) {
      const {faultInspectionWindow, allowedFaults} = executionBuilder;
      const slotsPresent = this.forkChoice.getSlotsPresent(clockSlot - faultInspectionWindow);
      const previousStatus = executionBuilder.status;
      const shouldEnable = slotsPresent >= Math.min(faultInspectionWindow - allowedFaults, clockSlot);

      executionBuilder.updateStatus(shouldEnable ? BuilderStatus.enabled : BuilderStatus.circuitBreaker);
      // The status changed we should log
      const status = executionBuilder.status;
      const builderLog = {
        status,
        slotsPresent,
        faultInspectionWindow,
        allowedFaults,
      };
      if (status !== previousStatus) {
        this.logger.info("External builder status updated", builderLog);
      } else {
        this.logger.verbose("External builder status", builderLog);
      }
    }
  }

  /** Prepare consensus state, builder status, EL payload and SSE events for the next slot. */
  async prepareForNextSlot(clockSlot: Slot): Promise<PrepareNextSlotResponse> {
    try {
      return {ok: true, data: await prepareForNextSlot.call(this, clockSlot)};
    } catch (e) {
      return {
        ok: false,
        code:
          isErrorAborted(e) || isQueueErrorAborted(e) ? BeaconEngineErrorCode.ABORTED : BeaconEngineErrorCode.INTERNAL,
        payload: {message: e instanceof Error ? e.message : String(e)},
      };
    }
  }

  /**
   * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#recomputeForkChoiceHead.
   * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
   */
  recomputeForkChoiceHead(caller: ForkchoiceCaller): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller});

    try {
      const prevHead = this.forkChoice.getHead();
      const head = this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetCanonicalHead}).head;
      this.emitHeadEvents(prevHead, head);
      return head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetCanonicalHead});
      throw e;
    } finally {
      timer?.();
    }
  }

  /**
   * Runs inside BeaconEngine. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#predictProposerHead.
   * Sync with that source on unstable merges; differences are tagged `[beacon-engine] deviation`.
   */
  predictProposerHead(): ProtoBlock {
    this.metrics?.forkChoice.requests.inc();
    const timer = this.metrics?.forkChoice.findHead.startTimer({caller: FindHeadFnName.predictProposerHead});
    const slot = this.clock.currentSlot;
    const secFromSlot = this.clock.secFromSlot(slot);

    try {
      return this.forkChoice.updateAndGetHead({mode: UpdateHeadOpt.GetPredictedProposerHead, secFromSlot, slot}).head;
    } catch (e) {
      this.metrics?.forkChoice.errors.inc({entrypoint: UpdateHeadOpt.GetPredictedProposerHead});
      throw e;
    } finally {
      this.publishChainView(false);
      timer?.();
    }
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

  // Gossip validation flows. Each method takes the message's SSZ bytes first (unused by this JS impl;
  // present for the native engine's bytes-first contract) and delegates to the validation logic in
  // `../validation/*` rebound onto the engine.
  async validateGossipBlock(
    _blockBytes: Uint8Array,
    signedBlock: SignedBeaconBlock,
    fork: ForkName,
    // API publication also call this with no seenTimestampSec
    seenTimestampSec?: number
  ): Promise<GossipValidationResult<GossipBlockValidationResult>> {
    const payloadBlockRoot = isForkPostGloas(fork)
      ? toRootHex(this.config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message))
      : null;
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#validateBeaconBlock.
    // Seed on entry, including blocks whose parent is still unknown.
    if (payloadBlockRoot !== null) {
      this.seenPayloadEnvelopeInputCache.add({
        blockRootHex: payloadBlockRoot,
        block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
        forkName: fork,
      });
    }
    let result: GossipValidationResult<GossipBlockValidationResult>;
    try {
      result = await runGossipValidation(() => validateGossipBlock.call(this, signedBlock, fork));
    } catch (error) {
      if (payloadBlockRoot !== null && seenTimestampSec !== undefined) {
        this.seenPayloadEnvelopeInputCache.remove(payloadBlockRoot);
      }
      throw error;
    }
    if (
      payloadBlockRoot !== null &&
      seenTimestampSec !== undefined &&
      (result.status === GossipValidationStatus.Reject ||
        (result.status === GossipValidationStatus.Ignore &&
          result.code === BlockErrorCode.REPEAT_PROPOSAL &&
          !this.hasObservedBlockRoot(signedBlock.message.slot, signedBlock.message.proposerIndex, payloadBlockRoot)))
    ) {
      this.seenPayloadEnvelopeInputCache.remove(payloadBlockRoot);
    }
    if (this.validatorMonitor && seenTimestampSec !== undefined) {
      const {slot, proposerIndex} = signedBlock.message;
      const blockRoot =
        payloadBlockRoot ?? toRootHex(this.config.getForkTypes(slot).BeaconBlock.hashTreeRoot(signedBlock.message));
      const registerBlock = (): void => {
        if (this.closed) return;
        try {
          this.validatorMonitor?.registerBeaconBlock(OpSource.gossip, this.clock.secFromSlot(slot, seenTimestampSec), {
            slot,
            proposerIndex,
            blockRoot,
          });
        } catch (e) {
          this.logger.debug("Error monitoring gossip block", {slot, root: blockRoot}, e as Error);
        }
      };
      // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#handleValidBeaconBlock.
      // [beacon-engine] deviation: accepted-block monitoring has its own deferred callback, preceding
      // the facade import handler. Observed siblings are still monitored before returning IGNORE.
      if (result.status === GossipValidationStatus.Accept) {
        callInNextEventLoop(registerBlock);
      } else if (
        result.status === GossipValidationStatus.Ignore &&
        result.code === BlockErrorCode.REPEAT_PROPOSAL &&
        this.hasObservedBlockRoot(slot, proposerIndex, blockRoot)
      ) {
        registerBlock();
      }
    }
    return result;
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
      if (this.validatorMonitor) {
        callInNextEventLoop(() => {
          if (this.closed) return;
          try {
            this.validatorMonitor?.registerGossipSyncContributionAndProof(
              signedContributionAndProof.message,
              result.syncCommitteeParticipantIndices
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip contribution and proof",
              {slot: signedContributionAndProof.message.contribution.slot},
              e as Error
            );
          }
        });
      }
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
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateGossipGloasDataColumnSidecar.call(this, dataColumnSidecar, gossipSubnet, this.metrics)
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
      // TODO - beacon engine: schedule these side effects after the gossip verdict, as upstream does.
      try {
        this.insertPayloadAttestationOnAccept(payloadAttestationMessage, result, "gossip");
      } catch (e) {
        this.logger.debug(
          "Error handling gossip payload attestation message",
          {slot: payloadAttestationMessage.data.slot, root: toRootHex(payloadAttestationMessage.data.beaconBlockRoot)},
          e as Error
        );
      }
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
      const nextSlotProposer = this.getHeadState().getBeaconProposer(message.data.slot + 1);
      if (this.beaconProposerCache.get(nextSlotProposer) !== undefined) {
        try {
          const insertOutcome = this.payloadAttestationPool.add(message, attDataRootHex, validatorCommitteeIndices);
          this.metrics?.opPool.payloadAttestationPool.gossipInsertOutcome.inc({insertOutcome});
        } catch (e) {
          this.logger.debug("Error adding to payloadAttestation pool", {}, e as Error);
        }
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
    seenTimestampSecs: number[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}> {
    const {results, batchableBls} = await validateGossipAttestationsSameAttData.call(this, fork, attestations);
    const mapped = results.map(fromResult);
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#getBatchHandlers.
    // Consult current duties after validation. [beacon-engine] deviation: pool/fork-choice writes
    // still precede the returned verdict instead of running in the deferred network handler.
    for (const res of mapped) {
      if (res.status !== GossipValidationStatus.Accept) {
        continue;
      }
      const value = res.value;
      if (this.aggregatorTracker.shouldAggregate(value.subnet, value.indexedAttestation.data.slot)) {
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
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#getBatchHandlers.
    if (this.validatorMonitor) {
      callInNextEventLoop(() => {
        if (this.closed) return;
        for (const [i, res] of mapped.entries()) {
          if (res.status !== GossipValidationStatus.Accept) continue;
          try {
            this.validatorMonitor?.registerGossipUnaggregatedAttestation(
              seenTimestampSecs[i],
              res.value.indexedAttestation
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip attestation",
              {slot: res.value.indexedAttestation.data.slot},
              e as Error
            );
          }
        }
      });
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
    signedAggregateAndProof: SignedAggregateAndProof,
    seenTimestampSec: number
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
      if (this.validatorMonitor) {
        callInNextEventLoop(() => {
          if (this.closed) return;
          try {
            this.validatorMonitor?.registerGossipAggregatedAttestation(
              seenTimestampSec,
              signedAggregateAndProof,
              result.indexedAttestation
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip aggregate and proof",
              {slot: result.indexedAttestation.data.slot},
              e as Error
            );
          }
        });
      }
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
    source: SourceMeta
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      await validateGossipExecutionPayloadEnvelope.call(this, executionPayloadEnvelope);
      this.seenPayloadEnvelopeInputCache
        .get(toRootHex(executionPayloadEnvelope.message.beaconBlockRoot))
        ?.addPayloadEnvelope({
          envelope: executionPayloadEnvelope,
          ...source,
        });
      // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#execution_payload.
      if (source.source === PayloadEnvelopeInputSource.gossip && this.validatorMonitor) {
        const slot = executionPayloadEnvelope.message.payload.slotNumber;
        try {
          this.validatorMonitor.registerExecutionPayloadEnvelope(
            OpSource.gossip,
            this.clock.secFromSlot(slot, source.seenTimestampSec),
            executionPayloadEnvelope
          );
        } catch (e) {
          this.logger.debug("Error monitoring gossip execution payload envelope", {slot}, e as Error);
        }
      }
    });
  }

  validateApiExecutionPayloadEnvelope(
    _envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(async () => {
      await validateApiExecutionPayloadEnvelope.call(this, executionPayloadEnvelope);
      this.seenPayloadEnvelopeInputCache
        .get(toRootHex(executionPayloadEnvelope.message.beaconBlockRoot))
        ?.addPayloadEnvelope({
          envelope: executionPayloadEnvelope,
          source: PayloadEnvelopeInputSource.api,
          seenTimestampSec,
        });
    });
  }

  validateGossipExecutionPayloadBid(
    _bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
    return runGossipValidation(async () => {
      const result = await validateGossipExecutionPayloadBid.call(this, signedExecutionPayloadBid);
      // TODO - beacon engine: reconcile deferred gossip side effects with upstream before completing this merge.
      // Insert into the bid pool on Accept (moved from the gossip handler).
      try {
        const insertOutcome = this.executionPayloadBidPool.add(
          signedExecutionPayloadBid,
          Math.floor(this.clock.secFromSlot(signedExecutionPayloadBid.message.slot, seenTimestampSec) * 1000)
        );
        this.metrics?.opPool.executionPayloadBidPool.gossipInsertOutcome.inc({insertOutcome});
        // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#execution_payload_bid.
        if (this.validatorMonitor) {
          callInNextEventLoop(() => {
            if (this.closed) return;
            try {
              this.validatorMonitor?.registerExecutionPayloadBid(
                OpSource.gossip,
                result.proposerIndex,
                signedExecutionPayloadBid.message
              );
            } catch (e) {
              this.logger.debug(
                "Error monitoring gossip execution payload bid",
                {slot: signedExecutionPayloadBid.message.slot},
                e as Error
              );
            }
          });
        }
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
    return runGossipValidation(() => validateApiExecutionPayloadBid.call(this, signedExecutionPayloadBid));
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
        this.opPool.insertAttesterSlashing(fork, attesterSlashing, res.value);
        this.forkChoice.onAttesterSlashing(attesterSlashing);
      } catch (e) {
        this.logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    }
    return res.status === GossipValidationStatus.Accept ? {...res, value: undefined} : res;
  }

  async validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void> {
    const verifiedDomains = await validateApiAttesterSlashing.call(this, attesterSlashing);
    this.opPool.insertAttesterSlashing(fork, attesterSlashing, verifiedDomains);
  }

  async validateGossipProposerSlashing(
    proposerSlashing: phase0.ProposerSlashing
  ): Promise<GossipValidationResult<void>> {
    const res = await runGossipValidation(() => validateGossipProposerSlashing.call(this, proposerSlashing));
    if (res.status === GossipValidationStatus.Accept) {
      try {
        this.opPool.insertProposerSlashing(proposerSlashing, res.value);
      } catch (e) {
        this.logger.error("Error adding proposerSlashing to pool", {}, e as Error);
      }
    }
    return res.status === GossipValidationStatus.Accept ? {...res, value: undefined} : res;
  }

  async validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    const verifiedDomain = await validateApiProposerSlashing.call(this, proposerSlashing);
    this.opPool.insertProposerSlashing(proposerSlashing, verifiedDomain);
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

  async validateApiVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<ApiVoluntaryExitResult & {inserted?: boolean}> {
    const result = await validateApiVoluntaryExit.call(this, voluntaryExit);
    if (result.status === "deferred")
      return {
        ...result,
        inserted: this.deferredVoluntaryExitPool.insert(voluntaryExit, result.validity, this.clock.currentEpoch),
      };
    this.opPool.insertVoluntaryExit(voluntaryExit);
    return result;
  }

  drainDeferredVoluntaryExits(): phase0.SignedVoluntaryExit[] {
    return this.deferredVoluntaryExitPool.drainProcessableExits(this.getHeadState());
  }

  insertVoluntaryExit(exit: phase0.SignedVoluntaryExit): void {
    this.opPool.insertVoluntaryExit(exit);
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

  getPoolProposerPreferences(slot?: Slot, dependentRoot?: RootHex): gloas.SignedProposerPreferences[] {
    return this.proposerPreferencesPool.getAll(slot, dependentRoot);
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
    return [...this.aggregatedAttestationPool.getAll(bySlot), ...this.attestationPool.getAll(bySlot)];
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

  /** Source: unstable@0edec865c8 network/network.ts#prepareBeaconCommitteeSubnets. */
  async prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    for (const subscription of subscriptions) {
      if (subscription.isAggregator) {
        this.aggregatorTracker.addAggregator(subscription.subnet, subscription.slot);
      }
    }
    this.aggregatorTracker.prune();
  }

  // --- Proposer cache + finalized balances (engine-internal) ---

  /** Fee recipient registered for a proposer, or undefined if none (block-production default is
   * resolved by the state-based production helper; import uses this for its FCU fee recipient). */
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
    this.seenPayloadEnvelopeInputCache.pruneFinalized(this.forkChoice.getFinalizedCheckpoint());
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
  /** TODO - beacon engine: preserve post-DA ordering when this command crosses the worker boundary. */
  observeVerifiedBlocks(blocks: {block: SignedBeaconBlock; root: RootHex}[], verifyOnly: boolean): void {
    for (const {block, root} of blocks) {
      const {slot, proposerIndex} = block.message;
      this.seenBlockProposers.observeBlockRoot(
        slot,
        proposerIndex,
        root,
        signedBlockToSignedHeader(this.config, block)
      );
      if (!verifyOnly && this.seenBlockProposers.isEquivocating(slot, proposerIndex)) {
        callInNextEventLoop(() => this.processProposerEquivocation(slot, proposerIndex));
      }
    }
  }

  markBlockProposersSeen(blocks: {slot: Slot; proposerIndex: ValidatorIndex; root: RootHex}[]): void {
    for (const {slot, proposerIndex, root} of blocks) this.seenBlockProposers.add(slot, proposerIndex, root);
  }

  hasObservedBlockRoot(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): boolean {
    return this.seenBlockProposers.hasBlockRoot(slot, proposerIndex, root);
  }
  isBlockProposerEquivocating(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.seenBlockProposers.isEquivocating(slot, proposerIndex);
  }
  getConflictingBlockRoots(slot: Slot, proposerIndex: ValidatorIndex, root: RootHex): RootHex[] {
    return this.seenBlockProposers.getConflictingBlockRoots(slot, proposerIndex, root);
  }
  async verifyAndObserveBlockProposer(_bytes: Uint8Array, block: SignedBeaconBlock, root: RootHex): Promise<void> {
    const forkName = this.config.getForkName(block.message.slot);
    if (isForkPostGloas(forkName)) {
      this.seenPayloadEnvelopeInputCache.add({
        blockRootHex: root,
        block: block as SignedBeaconBlock<ForkPostGloas>,
        forkName,
      });
    }
    await verifyBlockProposerSignature.call(this, block, root);
    this.seenBlockProposers.observeBlockRoot(
      block.message.slot,
      block.message.proposerIndex,
      root,
      signedBlockToSignedHeader(this.config, block)
    );
  }
  // TODO - beacon engine: map these API errors to plain result codes when introducing the worker transport.
  async verifyEnvelopeForPublish(
    _bytes: Uint8Array,
    signedEnvelope: gloas.SignedExecutionPayloadEnvelope,
    blockRootHex: RootHex
  ): Promise<void> {
    const block = this.forkChoice.getBlockHex(blockRootHex, PayloadStatus.EMPTY);
    if (block === null) throw new ApiError(404, `Block not found for beacon block root ${blockRootHex}`);
    const slot = signedEnvelope.message.payload.slotNumber;
    const state = await this.regen
      .getBlockSlotState(block, block.slot, {dontTransferCache: true}, RegenCaller.restApi)
      .catch((e) => {
        this.logger.debug(
          "Failed to regenerate block state for consensus checks",
          {slot, blockRoot: blockRootHex},
          e as Error
        );
        return null;
      });
    if (state === null || !isStatePostGloas(state))
      throw new ApiError(
        500,
        `Unable to regenerate block state for consensus checks slot=${slot} blockRoot=${blockRootHex}`
      );
    try {
      verifyEnvelopeFields(this.config, state, signedEnvelope.message, {verifyExecutionRequestsRoot: false});
    } catch (e) {
      this.seenPayloadEnvelopeInputCache.removeInvalid(signedEnvelope);
      this.logger.error(
        "Consensus checks failed while publishing execution payload envelope",
        {slot, blockRoot: blockRootHex},
        e as Error
      );
      throw new ApiError(400, (e as Error).message);
    }
  }

  isVerifiedProposerSignature(blockRoot: RootHex, signature: BLSSignature): boolean {
    const cachedSignature = this.verifiedProposerSignatures.get(blockRoot);
    return cachedSignature !== undefined && byteArrayEquals(cachedSignature, signature);
  }

  markVerifiedProposerSignature(blockRoot: RootHex, signature: BLSSignature): void {
    this.verifiedProposerSignatures.set(blockRoot, Uint8Array.from(signature));
    pruneSetToMax(this.verifiedProposerSignatures, MAX_VERIFIED_PROPOSER_SIGNATURES);
  }

  isBlockProposerSeen(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.seenBlockProposers.isKnown(slot, proposerIndex);
  }

  async verifyBlocks(
    blockBytes: Uint8Array[],
    blockInputs: IBlockInput[],
    opts: BlockProcessOpts & ImportBlockOpts,
    signal: AbortSignal
  ): Promise<{segmentExecStatus: SegmentExecStatus; verifyStateTime: number; verifySignaturesTime: number}> {
    for (const blockInput of blockInputs) {
      if (isForkPostGloas(blockInput.forkName)) {
        this.seenPayloadEnvelopeInputCache.add({
          blockRootHex: blockInput.blockRootHex,
          block: blockInput.getBlock() as SignedBeaconBlock<ForkPostGloas>,
          forkName: blockInput.forkName,
        });
      }
    }
    try {
      return await verifyBlocks.call(this, blockBytes, blockInputs, opts, signal);
    } catch (error) {
      this.publishChainView();
      throw error;
    }
  }

  async importBlock(
    blockRoot: Root,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<ImportBlockResult> {
    // bytes-first input (native engine FFI); the JS cache is keyed by hex.
    const blockRootHex = toRootHex(blockRoot);
    const v = this.verifiedBlocks.get(blockRootHex);
    if (!v) throw Error(`No verified block found for root ${blockRootHex}`);

    try {
      return await importBlock.call(this, v, dataAvailabilityStatus, opts);
    } catch (error) {
      this.publishChainView();
      throw error;
    } finally {
      this.verifiedBlocks.delete(blockRootHex);
    }
  }

  /** Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts#importExecutionPayload. */
  async importExecutionPayload(
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<{executionOptimistic: boolean}> {
    return importExecutionPayload.call(this, envelopeBytes, dataAvailabilityStatus, opts);
  }

  discardVerifiedBlocks(blockRootHexes: string[]): void {
    for (const r of blockRootHexes) {
      this.verifiedBlocks.delete(r);
    }
  }

  // --- Fork-choice writes (routed here so the facade never writes fork choice directly) ---

  updateTime(currentSlot: Slot): void {
    const previous = this.forkChoice.getHead();
    this.forkChoice.updateTime(currentSlot);
    this.emitHeadEvents(previous, this.forkChoice.getHead(), false);
  }

  // --- DB ownership (blocks + states + payload envelopes) ---

  async migrateCanonicalBlocks(): Promise<Slot[]> {
    return migrateBlocksFromHotToColdDb.call(this);
  }
  async migrateExecutionPayloadEnvelopes(): Promise<Slot[]> {
    return migrateExecutionPayloadEnvelopes.call(this);
  }
  async deleteNonCanonicalExecutionPayloadEnvelopes(roots: Uint8Array[]): Promise<void> {
    return deleteNonCanonicalExecutionPayloadEnvelopes.call(this, roots);
  }
  async persistOrphanedBlocks(blocks: FinalizedProtoSummary[], directory?: string): Promise<void> {
    return persistOrphanedBlocks.call(this, blocks, directory);
  }
  async deleteNonCanonicalBlocks(roots: Uint8Array[]): Promise<void> {
    return deleteNonCanonicalBlocks.call(this, roots);
  }
  async completeFinalization(finalized: CheckpointWithHex): Promise<number> {
    return completeFinalization.call(this, finalized, this.stateArchiveStrategy);
  }
  async getEarliestArchivedBlockSlot(): Promise<Slot | null> {
    return this.db.blockArchive.firstKey();
  }

  async persistFinalizedStateToDisk(): Promise<void> {
    return this.stateArchiveStrategy.archiveState(this.forkChoice.getFinalizedCheckpoint());
  }

  async archiveStateOnCheckpoint(): Promise<void> {
    const headStateRoot = this.forkChoice.getHead().stateRoot;
    this.regen.onCheckpoint(
      this.forkChoice.getFinalizedCheckpoint().epoch,
      this.forkChoice.getJustifiedCheckpoint().epoch,
      headStateRoot
    );
    await this.stateArchiveStrategy.onCheckpoint(headStateRoot, this.metrics);
  }

  /** Prune finalized blocks, states and envelopes below the retention window. */
  async pruneHistory(finalizedEpoch: Epoch, currentEpoch: Epoch): Promise<Slot> {
    const {blockCutoffSlot, stateCutoffSlot} = await pruneHistory.call(
      this,
      finalizedEpoch,
      currentEpoch,
      this.statePruneFromSlot
    );
    this.statePruneFromSlot = stateCutoffSlot;
    return blockCutoffSlot;
  }

  /** Populate the (engine-owned) op pool from its persisted DB repos. Call once on startup. */
  async loadOpPoolFromDisk(): Promise<void> {
    await this.opPool.fromPersisted(this.db, this.getHeadState(), this.bls, this.clock.currentSlot);
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
  async dropCache(): Promise<void> {
    await this.regen.dropCache();
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

  async registerLocalValidators(indices: ValidatorIndex[]): Promise<void> {
    for (const index of indices) this.validatorMonitor?.registerLocalValidator(index);
  }

  async registerLocalValidatorsInSyncCommittee(
    subscriptions: {validatorIndex: ValidatorIndex; untilEpoch: Epoch}[]
  ): Promise<void> {
    for (const {validatorIndex, untilEpoch} of subscriptions) {
      this.validatorMonitor?.registerLocalValidatorInSyncCommittee(validatorIndex, untilEpoch);
    }
  }

  async registerApiBlock(seenTimestampSec: number, block: ValidatorMonitorBlock): Promise<void> {
    this.validatorMonitor?.registerBeaconBlock(
      OpSource.api,
      this.clock.secFromSlot(block.slot, seenTimestampSec),
      block
    );
  }

  async registerApiExecutionPayloadEnvelope(
    delaySec: number,
    signedExecutionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
  ): Promise<void> {
    this.validatorMonitor?.registerExecutionPayloadEnvelope(OpSource.api, delaySec, signedExecutionPayloadEnvelope);
  }

  async onPoolSubmitUnaggregatedAttestation(
    seenTimestampSec: number,
    attestation: ValidatorMonitorAttestation,
    subnet: SubnetID,
    sentPeers: number
  ): Promise<void> {
    this.validatorMonitor?.onPoolSubmitUnaggregatedAttestation(seenTimestampSec, attestation, subnet, sentPeers);
  }

  async onPoolSubmitAggregatedAttestation(
    seenTimestampSec: number,
    attestation: ValidatorMonitorAttestation,
    sentPeers: number
  ): Promise<void> {
    this.validatorMonitor?.onPoolSubmitAggregatedAttestation(seenTimestampSec, attestation, sentPeers);
  }

  async getMonitoredValidatorIndices(): Promise<ValidatorIndex[]> {
    return this.validatorMonitor?.getMonitoredValidatorIndices() ?? [];
  }

  async scrapeValidatorMonitorMetrics(): Promise<string> {
    return this.validatorMonitorMetrics?.metrics() ?? "";
  }

  /**
   * On each checkpoint, warm the shuffling cache. Re-fetches the checkpoint state from regen (it was just
   * added to the checkpoint-state cache before the event fired) so the state never rides on the event.
   */
  private onCheckpoint(cp: phase0.Checkpoint): void {
    const state = this.regen.getCheckpointStateSync({epoch: cp.epoch, rootHex: toRootHex(cp.root)});
    // Defer to not block other checkpoint event handlers, which can cause lightclient update delays
    if (state) callInNextEventLoop(() => this.shufflingCache.processState(state));
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
          dataColumnDir: this.dataColumnDir,
          nativeStateTransition: this.opts.nativeStateTransition ?? false,
        },
        config: this.config,
        metrics: this.metrics,
        logger: this.logger as LoggerNode,
        signal: this.signal,
      });
    }
  }

  /** Tear down engine-owned resources: historical-state worker + BLS pool (graceful shutdown). */
  async close(): Promise<void> {
    this.closed = true;
    this.onValidatorMonitorAbort();
    this.signal.removeEventListener("abort", this.onValidatorMonitorAbort);
    await this.pendingPersistence?.catch(() => {});
    this.pendingPersistence = undefined;
    if (this.onSlot) this.clock.off(ClockEvent.slot, this.onSlot);
    if (this.onEpoch) this.clock.off(ClockEvent.epoch, this.onEpoch);
    this.emitter?.off(ChainEvent.checkpoint, this.checkpointListener);
    await this.historicalStateRegen?.close();
    await this.bls?.close();
    this.anchorState = undefined;
    this.anchorStateBytes = undefined;
    this.startupPhase = "closed";
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

  /** Serialized state for the debug `getStateV2` endpoint (the only whole-state-bytes crossing). */
  async getSerializedState(
    id: ApiStateId
  ): Promise<{state: Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    return getSerializedState.call(this, id);
  }

  /** Effective balances of `validatorIndices` from the finalized checkpoint state (custody group count). */
  async getFinalizedEffectiveBalances(
    finalizedCheckpoint: CheckpointWithHex,
    validatorIndices: ValidatorIndex[]
  ): Promise<number[] | null> {
    return getFinalizedEffectiveBalances.call(this, finalizedCheckpoint, validatorIndices);
  }

  /** Multi-proof of the resolved state for the given SSZ `descriptor`; null if the state is unavailable. */
  async getStateProof(
    id: ApiStateId,
    descriptor: Uint8Array
  ): Promise<{proof: CompactMultiProof; fork: ForkName} | null> {
    return getStateProof.call(this, id, descriptor);
  }

  /** Historical summaries + single-proof of the resolved state; null if unavailable (post-capella only). */
  async getHistoricalSummaries(id: ApiStateId): Promise<{
    slot: Slot;
    historicalSummaries: capella.HistoricalSummaries;
    proof: Uint8Array[];
    fork: ForkName;
    executionOptimistic: boolean;
    finalized: boolean;
  } | null> {
    return getHistoricalSummaries.call(this, id);
  }

  /** Resolve per-epoch shuffling and build indexed attestations (attester-slashing debug helper). */
  async getIndexedAttestationsForSlashing(
    requests: {slot: Slot; epoch: Epoch; attestations: Attestation[]}[],
    forkSeq: ForkSeq
  ): Promise<IndexedAttestation[]> {
    return getIndexedAttestationsForSlashing.call(this, requests, forkSeq);
  }

  async getStateBuilders(
    id: ApiStateId,
    builderIds: routes.beacon.BuilderId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.BuilderResponse[]>> {
    return getStateBuilders.call(this, id, builderIds, statuses);
  }

  // --- beacon/state API family (each resolves state internally, returns a targeted DTO) ---

  async getStateRoot(id: ApiStateId): Promise<ApiStateResult<{root: Root}>> {
    return getStateRoot.call(this, id);
  }

  async getStateFork(id: ApiStateId): Promise<ApiStateResult<phase0.Fork>> {
    return getStateFork.call(this, id);
  }

  async getStateRandao(id: ApiStateId, epoch?: Epoch): Promise<ApiStateResult<{randao: Bytes32}>> {
    return getStateRandao.call(this, id, epoch);
  }

  async getStateFinalityCheckpoints(id: ApiStateId): Promise<
    ApiStateResult<{
      currentJustified: phase0.Checkpoint;
      previousJustified: phase0.Checkpoint;
      finalized: phase0.Checkpoint;
    }>
  > {
    return getStateFinalityCheckpoints.call(this, id);
  }

  async getStateValidators(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse[]>> {
    return getStateValidators.call(this, id, validatorIds, statuses);
  }

  async getStateValidatorIdentities(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorIdentities>> {
    return getStateValidatorIdentities.call(this, id, validatorIds);
  }

  async getStateValidator(
    id: ApiStateId,
    validatorId: routes.beacon.ValidatorId
  ): Promise<ApiStateResult<routes.beacon.ValidatorResponse>> {
    return getStateValidator.call(this, id, validatorId);
  }

  async getStateValidatorBalances(
    id: ApiStateId,
    validatorIds: routes.beacon.ValidatorId[]
  ): Promise<ApiStateResult<routes.beacon.ValidatorBalance[]>> {
    return getStateValidatorBalances.call(this, id, validatorIds);
  }

  async getEpochCommittees(
    id: ApiStateId,
    filters: {epoch?: Epoch; index?: CommitteeIndex; slot?: Slot}
  ): Promise<ApiStateResult<routes.beacon.EpochCommitteeResponse[]>> {
    return getEpochCommittees.call(this, id, filters);
  }

  /** Source: unstable@ba0411b482 api/impl/beacon/state/index.ts#getStatePtc. */
  async getStatePtc(id: ApiStateId, slot?: Slot): Promise<ApiStateResult<{slot: Slot; validators: ValidatorIndex[]}>> {
    return getStatePtc.call(this, id, slot);
  }

  async getEpochSyncCommittees(
    id: ApiStateId,
    epoch?: Epoch
  ): Promise<ApiStateResult<routes.beacon.EpochSyncCommitteeResponse>> {
    return getEpochSyncCommittees.call(this, id, epoch);
  }

  async getStatePendingDeposits(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingDeposits>> {
    return getStatePendingDeposits.call(this, id, returnBytes);
  }

  async getStatePendingPartialWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingPartialWithdrawals>> {
    return getStatePendingPartialWithdrawals.call(this, id, returnBytes);
  }

  async getStatePendingConsolidations(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | electra.PendingConsolidations>> {
    return getStatePendingConsolidations.call(this, id, returnBytes);
  }

  async getStateProposerLookahead(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | fulu.ProposerLookahead>> {
    return getStateProposerLookahead.call(this, id, returnBytes);
  }

  /** Latest weak-subjectivity checkpoint epoch from the head state (lodestar debug). */
  getLatestWeakSubjectivityCheckpointEpoch(): Epoch {
    return this.getHeadState().getLatestWeakSubjectivityCheckpointEpoch();
  }

  /** Head-state `latestExecutionPayloadBid` (gloas empty-block detection in range sync); undefined pre-gloas. */
  getHeadProposerPubkey(slot: Slot): Uint8Array {
    return this.pubkeyCache.getPubkeyBytesOrThrow(this.getHeadState().getBeaconProposer(slot));
  }

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
    const block = slot < finalizedBlock.slot ? null : this.forkChoice.getCanonicalBlockAtSlot(slot);
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

  /** Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/chain.ts#produceProposerSlashing. */
  private async produceProposerSlashing(blockSlot: Slot, proposerIndex: ValidatorIndex): Promise<void> {
    if (this.opts.disableProposerSlashings === true || this.producingProposerSlashing.has(proposerIndex)) {
      return;
    }

    if (this.opPool.hasSeenProposerSlashing(proposerIndex)) {
      this.logger.debug("Not producing proposer slashing, already in the op pool", {
        slot: blockSlot,
        proposerIndex,
      });
      return;
    }

    const headers = this.seenBlockProposers.getEquivocationHeaders(blockSlot, proposerIndex);
    if (headers === null) {
      return;
    }

    this.producingProposerSlashing.add(proposerIndex);
    try {
      const [header1, header2] = headers;
      // ProposerSlashing uses the bigint variant of the signed block header, see types package for details
      const proposerSlashing: phase0.ProposerSlashing = {
        signedHeader1: {
          message: {...header1.message, slot: BigInt(header1.message.slot)},
          signature: header1.signature,
        },
        signedHeader2: {
          message: {...header2.message, slot: BigInt(header2.message.slot)},
          signature: header2.signature,
        },
      };

      try {
        const verifiedDomain = await validateApiProposerSlashing.call(this, proposerSlashing);
        this.opPool.insertProposerSlashing(proposerSlashing, verifiedDomain);
      } catch (e) {
        this.logger.debug("Produced proposer slashing is not valid", {slot: blockSlot, proposerIndex}, e as Error);
        return;
      }

      this.emitter.emit(routes.events.EventType.proposerSlashing, proposerSlashing);
      this.emitter.emit(ChainEvent.publishProposerSlashing, proposerSlashing);
      this.metrics?.opPool.proposerSlashingsProduced.inc();
      this.logger.info("Produced proposer slashing from observed equivocation", {
        slot: blockSlot,
        proposerIndex,
        header1Root: toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header1.message)),
        header2Root: toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header2.message)),
      });
    } finally {
      this.producingProposerSlashing.delete(proposerIndex);
    }
  }

  /** Runs inside BeaconEngine. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/chain.ts#processProposerEquivocation. */
  processProposerEquivocation(blockSlot: Slot, proposerIndex: ValidatorIndex): void {
    this.produceProposerSlashing(blockSlot, proposerIndex).catch((e) => {
      this.logger.debug("Error producing proposer slashing", {slot: blockSlot, proposerIndex}, e as Error);
    });
  }

  async getBuilderPendingPayments(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingPayments>> {
    return getBuilderPendingPayments.call(this, id, returnBytes);
  }

  async getBuilderPendingWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingWithdrawals>> {
    return getBuilderPendingWithdrawals.call(this, id, returnBytes);
  }

  // TODO - beacon engine: transport upstream head events through the worker event boundary.
  private emitHeadEvents(prevHead: ProtoBlock, head: ProtoBlock, blocksChanged = true): void {
    this.publishChainView(blocksChanged);
    const headRootChanged = head.blockRoot !== prevHead.blockRoot;

    if (!headRootChanged && prevHead.payloadStatus === head.payloadStatus) {
      return;
    }

    try {
      const previousDutyDependentRoot = this.forkChoice.getDependentRoot(head, EpochDifference.previous);
      const currentDutyDependentRoot = this.forkChoice.getDependentRoot(head, EpochDifference.current);
      const epochTransition = computeStartSlotAtEpoch(computeEpochAtSlot(head.slot)) === head.slot;
      const executionOptimistic = isOptimisticBlock(head);

      if (headRootChanged) {
        this.emitter.emit(routes.events.EventType.head, {
          block: head.blockRoot,
          epochTransition,
          slot: head.slot,
          state: head.stateRoot,
          previousDutyDependentRoot,
          currentDutyDependentRoot,
          executionOptimistic,
        });
      }

      this.emitter.emit(routes.events.EventType.headV2, {
        version: this.config.getForkName(head.slot),
        data: {
          slot: head.slot,
          block: head.blockRoot,
          state: head.stateRoot,
          payloadStatus: head.payloadStatus === PayloadStatus.FULL ? "full" : "empty",
          epochTransition,
          currentEpochDependentRoot: previousDutyDependentRoot,
          nextEpochDependentRoot: currentDutyDependentRoot,
          executionOptimistic,
        },
      });
    } catch (e) {
      // getDependentRoot() may fail with error: "No block for root" as we can see in holesky non-finality issue
      this.logger.debug(
        "Error emitting head/head_v2 event",
        {slot: head.slot, root: head.blockRoot, headRootChanged},
        e as Error
      );
    }
  }
}

export {type StateValidatorIndexResponse, getStateBuilderIndex, getStateValidatorIndex} from "./beaconApis.js";
