import {setMaxListeners} from "node:events";
import {
  init as initNativeMetrics,
  registerLocalValidator as registerNativeLocalValidator,
  scrapeMetrics as scrapeNativeMetrics,
  unregisterLocalValidator as unregisterNativeLocalValidator,
} from "@chainsafe/lodestar-z/metrics";
import {type PubkeyCache, pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {BeaconConfig, chainConfigFromJson, createBeaconConfig} from "@lodestar/config";
import {Db} from "@lodestar/db";
import {LevelDbController} from "@lodestar/db/controller/level";
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
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {
  ForkName,
  ForkPostBellatrix,
  ForkPostGloas,
  ForkPreGloas,
  ForkSeq,
  GENESIS_SLOT,
  SLOTS_PER_EPOCH,
  isForkPostDeneb,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  EffectiveBalanceIncrements,
  EpochShuffling,
  IBeaconStateView,
  IBeaconStateViewGloas,
  computeEndSlotAtEpoch,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createBeaconStateView,
  isStatePostAltair,
  isStatePostBellatrix,
  isStatePostElectra,
  isStatePostGloas,
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
  SignedBlindedBeaconBlock,
  SignedBlockContents,
  SingleAttestation,
  Slot,
  SubcommitteeIndex,
  SubnetID,
  ValidatorIndex,
  altair,
  bellatrix,
  capella,
  electra,
  fulu,
  getValidatorStatus,
  gloas,
  phase0,
  rewards,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {
  LodestarError,
  Logger,
  byteArrayEquals,
  fromHex,
  isErrorAborted,
  pruneSetToMax,
  toRootHex,
} from "@lodestar/utils";
import {ApiError, NodeIsSyncing} from "../../api/impl/errors.js";
import {HALF_SLOT_BPS} from "../../constants/index.js";
import {BeaconEngineDb} from "../../db/beaconEngine.js";
import {IBeaconEngineDb} from "../../db/index.js";
import {decodeArchivedEnvelope} from "../../db/repositories/index.js";
import {BuilderApiClient} from "../../execution/builder/apiClient.js";
import {BuilderStatus} from "../../execution/builder/http.js";
import {
  IExecutionBuilder,
  IExecutionEngine,
  initializeExecutionBuilder,
  initializeExecutionEngine,
} from "../../execution/index.js";
import {BeaconEngineMetrics, createBeaconEngineMetrics} from "../../metrics/index.js";
import {CommitteeSubscription} from "../../network/subnets/interface.js";
import {BufferPool} from "../../util/bufferPool.js";
import {Clock, IClock} from "../../util/clock.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {SerializedCache} from "../../util/serializedCache.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";
import {Result, wrapError} from "../../util/wrapError.js";
import {HistoricalStateRegen} from "../archiveStore/historicalState/historicalStateRegen.js";
import {ArchiveMode, StateArchiveStrategy} from "../archiveStore/interface.js";
import {FrequencyStateArchiveStrategy} from "../archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {CheckpointBalancesCache} from "../balancesCache.js";
import {BeaconProposerCache, ProposerPreparationData} from "../beaconProposerCache.js";
import {BlockBytes, BlockSerializedCache} from "../blocks/blockSerializedCache.js";
import {SourceMeta} from "../blocks/payloadEnvelopeInput/types.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {verifyExecutionPayloadEnvelope as verifyEnvelopeFields} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {BuilderCircuitBreaker} from "../builderCircuitBreaker.js";
import {ChainViewSnapshot, FinalizedProtoSummary} from "../chainView/interface.js";
import {LightClientServerError, LightClientServerErrorCode} from "../errors/lightClientError.js";
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
import {ShufflingCache, ShufflingPromiseCancelReason} from "../shufflingCache.js";
import {DbCPStateDatastore} from "../stateCache/datastore/db.js";
import {FileCPStateDatastore} from "../stateCache/datastore/file.js";
import {CPStateDatastore} from "../stateCache/datastore/types.js";
import {FIFOBlockStateCache} from "../stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache} from "../stateCache/persistentCheckpointsCache.js";
import {BlockStateCache, CheckpointStateCache} from "../stateCache/types.js";
import {ApiAttestation, AttestationValidationResult, GossipAttestation} from "../validation/attestation.js";
import {GossipBlockValidationResult, verifyBlockProposerSignature} from "../validation/block.js";
import * as proposerSlashingValidation from "../validation/proposerSlashing.js";
import type {ApiVoluntaryExitResult} from "../validation/voluntaryExit.js";
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
  getPersistedCheckpointState,
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
import {getAttesterDuties, getProposerDuties, getPtcDuties, getSyncCommitteeDuties} from "./duties.js";
import {BeaconEngineEvent, BeaconEngineEventBus} from "./events.js";
import {
  validateApiAggregateAndProof,
  validateApiAttestation,
  validateGossipAggregateAndProof,
  validateGossipAttestationsSameAttData,
} from "./gossipValidation/attestation.js";
import {validateGossipBlobSidecar, validateGossipBlock} from "./gossipValidation/block.js";
import {
  validateGossipFuluDataColumnSidecar,
  validateGossipGloasDataColumnSidecar,
} from "./gossipValidation/dataColumnSidecar.js";
import {
  validateApiExecutionPayloadBid,
  validateApiExecutionPayloadEnvelope,
  validateApiPayloadAttestationMessage,
  validateGossipExecutionPayloadBid,
  validateGossipExecutionPayloadEnvelope,
  validateGossipPayloadAttestationMessage,
} from "./gossipValidation/executionPayload.js";
import {
  validateGossipLightClientFinalityUpdate,
  validateGossipLightClientOptimisticUpdate,
} from "./gossipValidation/lightClient.js";
import {
  validateApiAttesterSlashing,
  validateApiBlsToExecutionChange,
  validateApiProposerSlashing,
  validateApiVoluntaryExit,
  validateGossipAttesterSlashing,
  validateGossipBlsToExecutionChange,
  validateGossipProposerPreferences,
  validateGossipProposerSlashing,
  validateGossipVoluntaryExit,
} from "./gossipValidation/operations.js";
import {
  validateApiSyncCommittee,
  validateApiSyncCommitteeContributionAndProof,
  validateGossipSyncCommittee,
  validateSyncCommitteeGossipContributionAndProof,
} from "./gossipValidation/syncCommittee.js";
import {GossipValidationResult} from "./gossipValidationResult.js";
import {VerifiedBlockBundle, importBlock} from "./importBlock.js";
import {importExecutionPayload} from "./importExecutionPayload.js";
import {AnchorSummary, EngineBootstrap} from "./initialization.js";
import type {ApiStateId} from "./interface.js";
import {
  ApiStateResult,
  ApiStateResultWithFork,
  BeaconEngineCoreModules,
  BeaconEngineErrorCode,
  HeadParentPayload,
  IBeaconEngineCore,
  ImportBlockResult,
  ImportExecutionPayloadOpts,
  PrepareNextSlotOpts,
  PrepareNextSlotResponse,
  ProduceBlockRequest,
  ProduceBlockResponse,
  ProduceBlockV4Request,
  ProduceBlockV4Response,
  SerializedLightClientData,
  VerifyBlocksOpts,
  VerifyBlocksSuccess,
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
import {BlockFailure, PayloadFailure, blockFailureFromError, payloadFailureFromError} from "./processingResult.js";
import {produceBlockWrapper, produceCommonBlockBody} from "./produceBlock.js";
import {produceBlockV4, produceEngineOrBuilderBlock} from "./produceEngineOrBuilderBlock.js";
import {SeenEnginePayloadEnvelopeInput} from "./seenEnginePayloadEnvelopeInput.js";
import {verifyBlocks} from "./verifyBlock.js";

const MAX_VERIFIED_PROPOSER_SIGNATURES = 3 * SLOTS_PER_EPOCH;

/** Owns consensus state. Anchor preparation precedes validation and runtime initialization. */
export class BeaconEngineCore implements IBeaconEngineCore {
  private readonly aggregatorTracker = new AggregatorTracker();
  readonly config: BeaconConfig;
  readonly opts: IBeaconEngineOptions;
  readonly logger: Logger;
  readonly metrics: BeaconEngineMetrics | null;
  readonly clock: IClock;
  genesisTime!: number;
  // Each thread imports a local wrapper over the same lock-protected native registry.
  readonly pubkeyCache: PubkeyCache = pubkeyCache;
  // NodeJS-specific memory pool for state serialization; engine-internal (not on IBeaconEngine).
  bufferPool!: BufferPool;
  bls!: IBlsVerifier;
  shufflingCache!: ShufflingCache;

  blockStateCache!: BlockStateCache;
  cpStateDatastore!: CPStateDatastore;
  checkpointStateCache!: CheckpointStateCache;
  checkpointBalancesCache!: CheckpointBalancesCache;
  readonly emitter = new BeaconEngineEventBus();
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
      this.emitter.emit(BeaconEngineEvent.fatalError, error);
    }
    const update = this.chainViewPublisher?.update(blocksChanged);
    if (update) this.emitter.emit(BeaconEngineEvent.chainViewUpdated, update);
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
  private readonly validatorMonitorLogger: Logger;
  private validatorMonitorTimeout?: ReturnType<typeof setTimeout>;
  private readonly onValidatorMonitorAbort = (): void => {
    clearTimeout(this.validatorMonitorTimeout);
    this.validatorMonitorTimeout = undefined;
  };
  // Engine owns envelope writes; the facade retains direct DB reads for API/reqresp serving.
  db!: IBeaconEngineDb;
  private rawDb?: Db;
  private stateArchiveStrategy!: StateArchiveStrategy;
  // Finalized writes are monotonic; restart from zero to include the newly persisted anchor.
  private statePruneFromSlot: Slot = 0;
  // Historical (below-finalized) state serving via a worker thread; built lazily on --serveHistoricalState.
  private historicalStateRegen?: HistoricalStateRegen;
  private readonly dbName: string;
  private readonly dataColumnDir: string;
  private readonly abortController = new AbortController();
  // TODO - beacon engine: internal helper context; keep this off the worker-facing interface.
  readonly signal = this.abortController.signal;
  lightClientServer?: LightClientServer;
  /**
   * Engine-owned verification results awaiting import, including post-states and execution status.
   * Bundles reference the same block and bytes returned by blockSerializedCache; they do not copy either.
   * API broadcast validation uses validateApiBlock and never creates or discards these bundles.
   * Retain them until import settles or discardVerifiedBlocks is called, independently of BlockSerializedCache
   * eviction/replacement and BeaconChain's persistence cleanup. Combining these stores would require
   * pinning the exact signed candidate while keeping verification results engine-owned.
   */
  readonly verifiedBlocks = new Map<string, VerifiedBlockBundle>();
  readonly serializedCache?: SerializedCache;
  readonly blockSerializedCache: BlockSerializedCache;

  readonly executionEngine: IExecutionEngine;
  builderApiClient!: BuilderApiClient;
  builderCircuitBreaker!: BuilderCircuitBreaker;
  readonly deferredVoluntaryExitPool: DeferredVoluntaryExitPool;
  private readonly producingProposerSlashing = new Set<ValidatorIndex>();
  readonly executionBuilder?: IExecutionBuilder;

  private startupPhase:
    | "created"
    | "opening"
    | "initialized"
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

  constructor(private readonly modules: BeaconEngineCoreModules) {
    const {opts} = modules;
    const config =
      modules.config !== undefined
        ? modules.config
        : createBeaconConfig(chainConfigFromJson(modules.chainConfigJson), modules.genesisValidatorsRoot);
    let logging = modules.logging;
    if (logging.type === "options") {
      const rootLogger = getNodeLogger(logging.opts);
      logging = {
        type: "injected",
        logger: rootLogger.child({module: "chain"}),
        executionEngineLogger: rootLogger.child({module: "execution"}),
        validatorMonitorLogger: rootLogger.child({module: "vmon"}),
      };
    }
    const {logger, executionEngineLogger = logger, validatorMonitorLogger = logger} = logging;
    const {signal} = this;
    setMaxListeners(Infinity, signal);
    const metrics = modules.metricsEnabled ? createBeaconEngineMetrics(opts.nativeStateTransition) : null;
    if (metrics && opts.nativeStateTransition) initNativeMetrics();
    this.executionBuilder = modules.executionBuilderOpts?.enabled
      ? initializeExecutionBuilder(modules.executionBuilderOpts, config, metrics, logger)
      : undefined;
    this.config = config;
    this.opts = opts;
    this.logger = logger;
    this.validatorMonitorLogger = validatorMonitorLogger;
    this.dbName = modules.dbName;
    this.dataColumnDir = modules.dataColumnDir;
    // Main-thread BeaconEngine shares this cache with BeaconChain; worker mode deserializes independently.
    this.serializedCache = modules.serializedCache;
    // Main-thread BeaconEngine shares this cache with BeaconChain; worker mode owns a separate instance.
    this.blockSerializedCache =
      modules.blockSerializedCache ??
      new BlockSerializedCache(config, {owner: "engine", metrics: metrics?.blockSerializedCache, logger});
    this.metrics = metrics;
    this.deferredVoluntaryExitPool = new DeferredVoluntaryExitPool(logger);
    try {
      // Main-thread BeaconEngine shares the node's execution client; worker mode creates its own.
      if (modules.executionEngine !== undefined) {
        this.executionEngine = modules.executionEngine;
      } else {
        if (modules.executionEngineOpts === undefined) {
          throw new LodestarError({code: "EXECUTION_ENGINE_OPTIONS_REQUIRED"});
        }
        this.executionEngine = initializeExecutionEngine(modules.executionEngineOpts, {
          signal,
          metrics,
          logger: executionEngineLogger,
        });
      }
      // Main-thread BeaconEngine shares the node's clock; worker mode creates its own.
      const clock = modules.clock ?? new Clock({config, genesisTime: modules.genesisTime, signal});
      this.clock = clock;
    } catch (error) {
      this.abortController.abort();
      metrics?.register.clear();
      throw error;
    }
  }

  async init(): Promise<void> {
    this.assertStartupPhase("created");
    this.startupPhase = "opening";
    const {config, opts, logger, metrics, clock, signal} = this;
    try {
      let db = this.modules.db;
      if (db === undefined) {
        this.rawDb = await LevelDbController.create({name: this.dbName}, {logger, metrics: metrics?.db});
        db = new BeaconEngineDb(config, this.rawDb);
      }
      this.db = db;
      this.cpStateDatastore =
        this.modules.cpStateDatastore ??
        ((opts.nHistoricalStatesFileDataStore ?? true)
          ? new FileCPStateDatastore(this.modules.dataDir)
          : new DbCPStateDatastore(db));
      this.lightClientServer = opts.disableLightClientServer
        ? undefined
        : new LightClientServer(opts, {config, clock, db, metrics, emitter: this.emitter, logger, signal});
      this.startupPhase = "initialized";
    } catch (error) {
      this.startupPhase = "failed";
      await this.close();
      throw error;
    }
  }

  async prepareAnchorState(stateBytes: Uint8Array): Promise<AnchorSummary> {
    this.assertStartupPhase("initialized");
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

  private assertStartupPhase(expected: "created" | "initialized" | "prepared"): void {
    if (this.closed || this.startupPhase !== expected) {
      throw new LodestarError({
        code: "BEACON_ENGINE_STARTUP_PHASE",
        expected,
        actual: this.closed ? "closed" : this.startupPhase,
      });
    }
  }

  onSlot!: (slot: Slot) => void;
  onEpoch!: (epoch: Epoch) => void;
  private readonly checkpointListener = this.onCheckpoint.bind(this);

  private initializeRuntime(anchorState: IBeaconStateView): void {
    const modules = this.modules;
    const {opts, validatorMonitorOpts, isAnchorStateFinalized} = modules;
    const {config, signal, logger, db} = this;
    const clock = this.clock;
    const metrics = this.metrics;
    metrics?.previousJustifiedEpoch.set(anchorState.previousJustifiedCheckpoint.epoch);
    metrics?.currentJustifiedEpoch.set(anchorState.currentJustifiedCheckpoint.epoch);
    // Source: unstable@0edec865c8 node/nodejs.ts#init. The monitor and registry stay with engine state.
    if (validatorMonitorOpts !== null) {
      this.validatorMonitor = createValidatorMonitor(
        metrics?.register ?? null,
        config,
        anchorState.genesisTime,
        this.validatorMonitorLogger,
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
    this.aggregatedAttestationPool = new AggregatedAttestationPool(config, metrics, logger);
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
        datastore: this.cpStateDatastore,
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
      this.emitter,
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
      emitter: this.emitter,
      signal,
    });

    // Engine owns the states DB, so it owns the state-archive strategy (finalized + temp + shutdown).
    if (opts.archiveMode === ArchiveMode.Frequency) {
      this.stateArchiveStrategy = new FrequencyStateArchiveStrategy(this.regen, db, logger, opts, this.bufferPool);
    } else {
      throw new Error(`State archive strategy "${opts.archiveMode}" currently not supported.`);
    }

    // Source: unstable@75239241d4 chain/chain.ts#onClockSlot and #onClockEpoch.
    // [beacon-engine] BeaconChain forwards clock events; engine-owned maintenance stays here.
    this.onSlot = (slot: Slot) => {
      this.attestationPool.prune(slot);
      this.aggregatedAttestationPool.prune(slot);
      this.syncCommitteeMessagePool.prune(slot);
      this.seenSyncCommitteeMessages.prune(slot);
      this.payloadAttestationPool.prune(slot);
      this.executionPayloadBidPool.prune(slot);
      this.seenExecutionPayloadBids.prune(slot);
      this.proposerPreferencesPool.prune(slot);
      this.seenAttestationDatas.onSlot(slot);

      // Source: unstable@2593063a82 chain/chain.ts#onClockSlot.
      if (metrics && (slot + 1) % SLOTS_PER_EPOCH === 0 && !this.closed && !this.signal.aborted) {
        clearTimeout(this.validatorMonitorTimeout);
        this.validatorMonitorTimeout = setTimeout(
          () => {
            this.validatorMonitorTimeout = undefined;
            try {
              this.validatorMonitor?.onceEveryEndOfEpoch(this.getHeadState());
            } catch (e) {
              if (!isErrorAborted(e))
                this.logger.error("Error on validator monitor onceEveryEndOfEpoch", {slot}, e as Error);
            }
          },
          this.config.getSlotComponentDurationMs(this.config.getForkName(slot), HALF_SLOT_BPS)
        );
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
    this.signal.addEventListener("abort", this.onValidatorMonitorAbort, {once: true});
    this.emitter.on(BeaconEngineEvent.checkpoint, this.checkpointListener);

    this.builderCircuitBreaker = new BuilderCircuitBreaker(this.opts, {
      forkChoice: this.forkChoice,
      logger: this.logger,
      metrics: this.metrics,
    });
    this.builderApiClient = new BuilderApiClient(
      modules.builderApiClientOpts ?? {},
      this.config,
      this.clock,
      this.bls,
      this.metrics,
      this.logger,
      (url) => {
        this.emitter.emit(BeaconEngineEvent.builderRegistered, url);
      }
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
  // Source: unstable@2593063a82 chain/chain.ts#regenStateForAttestationVerification.
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
    try {
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
    } catch (e) {
      this.shufflingCache.cancelPromise(attEpoch, shufflingDependentRoot, ShufflingPromiseCancelReason.regenError);
      throw e;
    }

    const stateDecisionRoot = state.getShufflingDecisionRoot(attEpoch);
    if (stateDecisionRoot !== shufflingDependentRoot) {
      // the promise would never be resolved by the state's shuffling
      this.shufflingCache.cancelPromise(
        attEpoch,
        shufflingDependentRoot,
        ShufflingPromiseCancelReason.decisionRootMismatch
      );
      this.logger.debug("Shuffling decision root mismatch on attestation regen", {
        slot: attHeadBlock.slot,
        root: attHeadBlock.blockRoot,
        epoch: attEpoch,
        shufflingDependentRoot,
        stateDecisionRoot,
      });

      throw Error(
        `Shuffling decision root mismatch epoch=${attEpoch} slot=${attHeadBlock.slot} root=${attHeadBlock.blockRoot} expected=${shufflingDependentRoot} actual=${stateDecisionRoot}`
      );
    }

    // resolve the promise to unblock other calls of the same epoch and dependent root
    this.shufflingCache.processState(state);
    return state.getShufflingAtEpoch(attEpoch);
  }

  /**
   * Runs inside BeaconEngineCore. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#getProposerHead.
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
  getFastConfirmationStore(): ReturnType<IBeaconEngineCore["getFastConfirmationStore"]> {
    return this.forkChoice.getFastConfirmationStore();
  }
  getConfirmedBlock(): ProtoBlock | null {
    return this.forkChoice.getConfirmedBlock();
  }

  // this is for debug apis only
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

  /** Runs inside BeaconEngineCore. Single V3 production entry and plain-data error boundary. */
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

  async registerAuthenticatedBuilder(url: string): Promise<void> {
    this.builderApiClient.registerAuthenticatedBuilder(url);
  }

  async registerValidator(epoch: Epoch, registrationsBytes: Uint8Array): Promise<void> {
    if (!this.executionBuilder) {
      throw Error("External builder not configured");
    }
    const registrations =
      this.serializedCache?.getDeserialized<bellatrix.SignedValidatorRegistrationV1[]>(registrationsBytes) ??
      routes.validator.SignedValidatorRegistrationV1ListType.deserialize(registrationsBytes);
    await this.executionBuilder.registerValidator(epoch, registrations);
  }

  async submitBlindedBlock(
    signedBlindedBlockBytes: Uint8Array,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<Uint8Array> {
    if (!this.executionBuilder) {
      throw Error("executionBuilder required to publish SignedBlindedBeaconBlock");
    }
    const signedBlindedBlock =
      this.serializedCache?.getDeserialized<SignedBlindedBeaconBlock>(signedBlindedBlockBytes) ??
      sszTypesFor(fork).SignedBlindedBeaconBlock.deserialize(signedBlindedBlockBytes);
    const contents = await this.executionBuilder.submitBlindedBlock({
      data: signedBlindedBlock,
      bytes: signedBlindedBlockBytes,
    });
    if (isForkPostDeneb(fork)) {
      const bytes = sszTypesFor(fork).SignedBlockContents.serialize(contents as SignedBlockContents<typeof fork>);
      this.serializedCache?.set(contents, bytes);
      return bytes;
    }
    const bytes = sszTypesFor(fork).SignedBeaconBlock.serialize(contents.signedBlock as SignedBeaconBlock<typeof fork>);
    this.serializedCache?.set(contents.signedBlock, bytes);
    return bytes;
  }

  async submitBlindedBlockNoResponse(
    signedBlindedBlockBytes: Uint8Array,
    fork: ForkPostBellatrix & ForkPreGloas
  ): Promise<void> {
    if (!this.executionBuilder) {
      throw Error("executionBuilder required to submit SignedBlindedBeaconBlock to builder");
    }
    const signedBlindedBlock =
      this.serializedCache?.getDeserialized<SignedBlindedBeaconBlock>(signedBlindedBlockBytes) ??
      sszTypesFor(fork).SignedBlindedBeaconBlock.deserialize(signedBlindedBlockBytes);
    await this.executionBuilder.submitBlindedBlockNoResponse({
      data: signedBlindedBlock,
      bytes: signedBlindedBlockBytes,
    });
  }

  /** Runs inside BeaconEngineCore. Single Gloas V4 production entry and plain-data error boundary. */
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
   * Runs inside BeaconEngineCore. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#updateBuilderStatus.
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

  /** Prepare consensus state, builder status, EL payload and requested payload attributes for the next slot. */
  async prepareForNextSlot(clockSlot: Slot, opts: PrepareNextSlotOpts): Promise<PrepareNextSlotResponse> {
    try {
      return {ok: true, data: await prepareForNextSlot.call(this, clockSlot, opts)};
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
   * Runs inside BeaconEngineCore. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#recomputeForkChoiceHead.
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
   * Runs inside BeaconEngineCore. Moved from unstable@551b8b0a3d packages/beacon-node/src/chain/chain.ts#predictProposerHead.
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
    opts: {currentEpoch: Epoch; checkpointWaitTimeoutMs?: number},
    v2: boolean
  ): Promise<{data: routes.validator.ProposerDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    return getProposerDuties.call(this, epoch, opts, v2, this.getHeadStateAtEpoch.bind(this));
  }

  /** Attester duties for `validatorIndices` at `epoch`. State resolved at `currentEpoch` (passed-in clock). */
  async getAttesterDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.AttesterDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    return getAttesterDuties.call(this, epoch, indices, currentEpoch, this.getHeadStateAtEpoch.bind(this));
  }

  /** Sync committee duties for `validatorIndices` at `epoch`. Synchronous — served from head state. */
  getSyncCommitteeDuties(
    epoch: Epoch,
    indices: ValidatorIndex[]
  ): {data: routes.validator.SyncDuty[]; head: ProtoBlock} {
    return getSyncCommitteeDuties.call(this, epoch, indices);
  }

  /** gloas: PTC duties for `validatorIndices` at `epoch`. State resolved at `currentEpoch` (passed-in clock). */
  async getPtcDuties(
    epoch: Epoch,
    indices: ValidatorIndex[],
    currentEpoch: Epoch
  ): Promise<{data: routes.validator.PtcDuty[]; dependentRoot: Root; head: ProtoBlock}> {
    return getPtcDuties.call(this, epoch, indices, currentEpoch, this.getHeadStateAtEpoch.bind(this));
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

  getLightClientServer(): LightClientServer {
    if (!this.lightClientServer) {
      throw new LightClientServerError({code: LightClientServerErrorCode.DISABLED}, "Light client server is disabled");
    }
    return this.lightClientServer;
  }

  async getLightClientBootstrap(blockRoot: Root): Promise<SerializedLightClientData> {
    const bootstrap = await this.getLightClientServer().getBootstrap(blockRoot);
    const slot = bootstrap.header.beacon.slot;
    return {data: this.config.getPostAltairForkTypes(slot).LightClientBootstrap.serialize(bootstrap), slot};
  }

  async getLightClientUpdate(period: number): Promise<SerializedLightClientData> {
    const update = await this.getLightClientServer().getUpdate(period);
    const slot = update.attestedHeader.beacon.slot;
    return {data: this.config.getPostAltairForkTypes(slot).LightClientUpdate.serialize(update), slot};
  }

  async getLightClientOptimisticUpdate(): Promise<SerializedLightClientData | null> {
    const update = this.getLightClientServer().getOptimisticUpdate();
    if (update === null) return null;
    const slot = update.attestedHeader.beacon.slot;
    return {data: this.config.getPostAltairForkTypes(slot).LightClientOptimisticUpdate.serialize(update), slot};
  }

  async getLightClientFinalityUpdate(): Promise<SerializedLightClientData | null> {
    const update = this.getLightClientServer().getFinalityUpdate();
    if (update === null) return null;
    const slot = update.attestedHeader.beacon.slot;
    return {data: this.config.getPostAltairForkTypes(slot).LightClientFinalityUpdate.serialize(update), slot};
  }

  async getLightClientCommitteeRoot(period: number): Promise<Root> {
    return Uint8Array.from(await this.getLightClientServer().getCommitteeRoot(period));
  }

  async pruneLightClientNonCheckpointData(roots: Root[]): Promise<void> {
    await this.lightClientServer?.pruneNonCheckpointData(roots);
  }

  validateGossipLightClientOptimisticUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>> {
    return validateGossipLightClientOptimisticUpdate.call(this, bytes, fork);
  }

  validateGossipLightClientFinalityUpdate(bytes: Uint8Array, fork: ForkName): Promise<GossipValidationResult<void>> {
    return validateGossipLightClientFinalityUpdate.call(this, bytes, fork);
  }

  // Gossip validation delegates to ./gossipValidation/* with engine-owned state.
  async validateGossipBlock(
    blockRoot: Root,
    blockBytes: Uint8Array,
    fork: ForkName,
    // API publication also call this with no seenTimestampSec
    seenTimestampSec?: number
  ): Promise<GossipValidationResult<GossipBlockValidationResult>> {
    return validateGossipBlock.call(this, () => this.closed, blockRoot, blockBytes, fork, seenTimestampSec);
  }

  validateGossipSyncCommittee(syncCommitteeBytes: Uint8Array, subnet: SubnetID): Promise<GossipValidationResult<void>> {
    return validateGossipSyncCommittee.call(this, syncCommitteeBytes, subnet);
  }

  // Returns the subnets to broadcast to (the facade publishes). Resolves committee membership + pool insert
  // internally so the facade never touches state or the pool for API sync-committee submission.
  validateApiSyncCommittee(
    _syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<{subnets: number[]}>> {
    return validateApiSyncCommittee.call(this, _syncCommitteeBytes, syncCommittee);
  }

  validateSyncCommitteeGossipContributionAndProof(
    contributionBytes: Uint8Array,
    skipValidationKnownParticipants = false
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
    return validateSyncCommitteeGossipContributionAndProof.call(
      this,
      () => this.closed,
      contributionBytes,
      skipValidationKnownParticipants
    );
  }

  validateApiSyncCommitteeContributionAndProof(
    _contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof
  ): Promise<GossipValidationResult<void>> {
    return validateApiSyncCommitteeContributionAndProof.call(this, _contributionBytes, signedContributionAndProof);
  }

  validateGossipBlobSidecar(
    blobBytes: Uint8Array,
    fork: ForkName,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return validateGossipBlobSidecar.call(this, blobBytes, fork, subnet);
  }

  validateGossipFuluDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return validateGossipFuluDataColumnSidecar.call(this, dataColumnBytes, gossipSubnet);
  }

  validateGossipGloasDataColumnSidecar(
    dataColumnBytes: Uint8Array,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return validateGossipGloasDataColumnSidecar.call(this, dataColumnBytes, gossipSubnet);
  }

  validateGossipPayloadAttestationMessage(payloadAttestationBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return validateGossipPayloadAttestationMessage.call(this, payloadAttestationBytes);
  }

  validateApiPayloadAttestationMessage(
    _payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<void>> {
    return validateApiPayloadAttestationMessage.call(this, _payloadAttestationBytes, payloadAttestationMessage);
  }

  // The batch attestation validator already returns `Result<T>[]` (caught internally, never throws out);
  // map each item to a `GossipValidationResult` so the batch is FFI-safe too. Per-item bytes live on each
  // `GossipAttestation.serializedData`, so there is no separate leading bytes parameter here.
  async validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[],
    seenTimestampSecs: number[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}> {
    return validateGossipAttestationsSameAttData.call(
      this,
      () => this.closed,
      this.aggregatorTracker,
      fork,
      attestations,
      seenTimestampSecs
    );
  }

  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>> {
    return validateApiAttestation.call(this, fork, attestationOrBytes);
  }

  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return validateGossipAggregateAndProof.call(this, () => this.closed, aggregateBytes, fork, seenTimestampSec);
  }

  validateApiAggregateAndProof(
    _aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
    return validateApiAggregateAndProof.call(this, _aggregateBytes, fork, signedAggregateAndProof);
  }

  validateGossipExecutionPayloadEnvelope(
    envelopeBytes: Uint8Array,
    source: SourceMeta
  ): Promise<GossipValidationResult<void>> {
    return validateGossipExecutionPayloadEnvelope.call(this, envelopeBytes, source);
  }

  validateApiExecutionPayloadEnvelope(
    _envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<void>> {
    return validateApiExecutionPayloadEnvelope.call(this, _envelopeBytes, executionPayloadEnvelope, seenTimestampSec);
  }

  validateGossipExecutionPayloadBid(
    bidBytes: Uint8Array,
    fork: ForkName,
    seenTimestampSec: number
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
    return validateGossipExecutionPayloadBid.call(this, () => this.closed, bidBytes, fork, seenTimestampSec);
  }

  validateApiExecutionPayloadBid(
    _bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<void>> {
    return validateApiExecutionPayloadBid.call(this, _bidBytes, signedExecutionPayloadBid);
  }

  async validateGossipProposerPreferences(preferencesBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return validateGossipProposerPreferences.call(this, preferencesBytes);
  }

  // --- Op pool: gossip validate (+ insert on Accept) / API validate (throws, + insert) / REST reads ---
  // The pools are engine-internal (not on IBeaconEngine's cache surface); the facade reaches them only
  // through these narrow methods. gossip = no-throw result; API = throws (preserves REST error shape).

  async validateGossipAttesterSlashing(
    attesterSlashingBytes: Uint8Array,
    fork: ForkName
  ): Promise<GossipValidationResult<void>> {
    return validateGossipAttesterSlashing.call(this, attesterSlashingBytes, fork);
  }

  async validateApiAttesterSlashing(attesterSlashing: AttesterSlashing, fork: ForkName): Promise<void> {
    return validateApiAttesterSlashing.call(this, attesterSlashing, fork);
  }

  async validateGossipProposerSlashing(proposerSlashingBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return validateGossipProposerSlashing.call(this, proposerSlashingBytes);
  }

  async validateApiProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<void> {
    return validateApiProposerSlashing.call(this, proposerSlashing);
  }

  async validateGossipVoluntaryExit(voluntaryExitBytes: Uint8Array): Promise<GossipValidationResult<void>> {
    return validateGossipVoluntaryExit.call(this, voluntaryExitBytes);
  }

  async validateApiVoluntaryExit(
    voluntaryExit: phase0.SignedVoluntaryExit
  ): Promise<ApiVoluntaryExitResult & {inserted?: boolean}> {
    return validateApiVoluntaryExit.call(this, voluntaryExit);
  }

  drainDeferredVoluntaryExits(): phase0.SignedVoluntaryExit[] {
    return this.deferredVoluntaryExitPool.drainProcessableExits(this.getHeadState());
  }

  insertVoluntaryExit(exit: phase0.SignedVoluntaryExit): void {
    this.opPool.insertVoluntaryExit(exit);
  }

  async validateGossipBlsToExecutionChange(
    blsToExecutionChangeBytes: Uint8Array
  ): Promise<GossipValidationResult<void>> {
    return validateGossipBlsToExecutionChange.call(this, blsToExecutionChangeBytes);
  }

  async validateApiBlsToExecutionChange(
    blsToExecutionChange: capella.SignedBLSToExecutionChange,
    preCapella: boolean
  ): Promise<void> {
    return validateApiBlsToExecutionChange.call(this, blsToExecutionChange, preCapella);
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

  /** Source: unstable@2593063a82 chain/chain.ts#updateAttachedValidators; custody remains facade-owned. */
  trackAttachedValidators(epoch: Epoch, validatorIndices: ValidatorIndex[]): boolean {
    let hasNewValidators = false;
    for (const validatorIndex of validatorIndices) {
      if (this.beaconProposerCache.track(epoch, validatorIndex)) hasNewValidators = true;
    }
    return hasNewValidators;
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
    this.blockSerializedCache.prune(computeStartSlotAtEpoch(this.forkChoice.getFinalizedCheckpoint().epoch));
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

  async validateApiBlock(
    blockRoot: Root,
    blockBytes: Uint8Array,
    opts: VerifyBlocksOpts
  ): Promise<Result<void, BlockFailure>> {
    return wrapError(
      async () => {
        await verifyBlocks.call(this, [{blockRoot, blockBytes}], {...opts, skipVerifyExecutionPayload: true}, false);
      },
      (error) => blockFailureFromError(error, this.config, [blockRoot])
    );
  }

  async verifyBlocks(blocks: BlockBytes[], opts: VerifyBlocksOpts): Promise<Result<VerifyBlocksSuccess, BlockFailure>> {
    return wrapError(
      () => verifyBlocks.call(this, blocks, opts),
      (error) => {
        this.publishChainView();
        return blockFailureFromError(
          error,
          this.config,
          blocks.map(({blockRoot}) => blockRoot)
        );
      }
    );
  }

  async importBlock(
    blockRoot: Root,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportBlockOpts
  ): Promise<Result<ImportBlockResult, BlockFailure>> {
    // bytes-first input (native engine FFI); the JS cache is keyed by hex.
    const blockRootHex = toRootHex(blockRoot);
    const v = this.verifiedBlocks.get(blockRootHex);
    if (!v) throw Error(`No verified block found for root ${blockRootHex}`);

    try {
      return await wrapError(
        () => importBlock.call(this, v, dataAvailabilityStatus, opts),
        (error) => {
          this.publishChainView();
          return blockFailureFromError(error, this.config, [blockRoot]);
        }
      );
    } finally {
      this.verifiedBlocks.delete(blockRootHex);
    }
  }

  /** Source: unstable@1bf214377e chain/blocks/importExecutionPayload.ts#importExecutionPayload. */
  async importExecutionPayload(
    envelopeBytes: Uint8Array,
    dataAvailabilityStatus: DataAvailabilityStatus,
    opts: ImportExecutionPayloadOpts
  ): Promise<Result<{executionOptimistic: boolean}, PayloadFailure>> {
    return wrapError(
      () => importExecutionPayload.call(this, envelopeBytes, dataAvailabilityStatus, opts),
      payloadFailureFromError
    );
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

  private async archiveStateOnCheckpoint(): Promise<void> {
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

  // Source: unstable@2593063a82 chain/chain.ts#loadFromDisk / persistToDisk; both pools stay engine-owned.
  /** Populate the (engine-owned) op pool from its persisted DB repos. Call once on startup. */
  async loadOpPoolFromDisk(): Promise<void> {
    await this.opPool.fromPersisted(this.db, this.getHeadState(), this.bls, this.clock.currentSlot);
    await this.proposerPreferencesPool.fromPersisted(this.db, this.clock.currentSlot);
  }

  /** Persist the (engine-owned) op pool to its DB repos. Call before stopping. */
  async persistOpPoolToDisk(): Promise<void> {
    await this.opPool.toPersisted(this.db);
    await this.proposerPreferencesPool.toPersisted(this.db);
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

  async scrapeMetrics(): ReturnType<IBeaconEngineCore["scrapeMetrics"]> {
    const metrics = this.metrics;
    if (!metrics || this.closed) return {metrics: [], extra: ""};
    if (this.startupPhase === "ready") {
      metrics.opPool.attesterSlashingPoolSize.set(this.opPool.attesterSlashingsSize);
      metrics.opPool.proposerSlashingPoolSize.set(this.opPool.proposerSlashingsSize);
      metrics.opPool.voluntaryExitPoolSize.set(this.opPool.voluntaryExitsSize);
      metrics.opPool.blsToExecutionChangePoolSize.set(this.opPool.blsToExecutionChangeSize);
      metrics.opPool.attestationPool.size.set(this.attestationPool.getAttestationCount());
      metrics.opPool.syncCommitteeMessagePoolSize.set(this.syncCommitteeMessagePool.size);
      metrics.opPool.payloadAttestationPool.size.set(this.payloadAttestationPool.size);
      metrics.opPool.executionPayloadBidPool.size.set(this.executionPayloadBidPool.size);
      const state = this.getHeadState();
      if (isStatePostElectra(state)) {
        metrics.pendingDeposits.set(state.pendingDepositsCount);
        metrics.pendingPartialWithdrawals.set(state.pendingPartialWithdrawalsCount);
        metrics.pendingConsolidations.set(state.pendingConsolidationsCount);
      }
    }
    const [collectedMetrics, historicalMetrics] = await Promise.all([
      metrics.register.getMetricsAsJSON(),
      this.historicalStateRegen?.scrapeMetrics(),
    ]);
    const extra = [historicalMetrics ?? ""];
    if (this.opts.nativeStateTransition) {
      try {
        extra.push(scrapeNativeMetrics());
      } catch (e) {
        this.logger.warn("Failed to scrape native state-transition metrics", {}, e as Error);
      }
    }
    // Detach prom-client samples in main-thread mode too.
    return {metrics: structuredClone(collectedMetrics), extra: extra.filter(Boolean).join("\n\n")};
  }

  /**
   * On each checkpoint, maintain regen caches and warm shuffling. Re-fetches the checkpoint state from regen (it was just
   * added to the checkpoint-state cache before the event fired) so the state never rides on the event.
   */
  private onCheckpoint(cp: phase0.Checkpoint): void {
    const state = this.regen.getCheckpointStateSync({epoch: cp.epoch, rootHex: toRootHex(cp.root)});
    // Defer to not block other checkpoint event handlers, which can cause lightclient update delays
    if (state) callInNextEventLoop(() => this.shufflingCache.processState(state));

    if (!this.opts.disableArchiveOnCheckpoint && !this.closed && !this.signal.aborted) {
      this.archiveStateOnCheckpoint().catch((err) => {
        this.logger.error("Error during state archive", {}, err);
      });
    }
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

  /** Tear down engine-owned resources. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.onValidatorMonitorAbort();
    this.signal.removeEventListener("abort", this.onValidatorMonitorAbort);
    await this.pendingPersistence?.catch(() => {});
    this.pendingPersistence = undefined;
    this.emitter?.off(BeaconEngineEvent.checkpoint, this.checkpointListener);
    try {
      await this.historicalStateRegen?.close();
      await this.bls?.close();
    } finally {
      this.abortController.abort();
      try {
        await this.rawDb?.close();
      } finally {
        this.metrics?.register.clear();
        this.anchorState = undefined;
        this.anchorStateBytes = undefined;
        this.startupPhase = "closed";
      }
    }
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

  async getPersistedCheckpointState(checkpoint?: phase0.Checkpoint): Promise<Uint8Array | null> {
    return getPersistedCheckpointState.call(this, checkpoint);
  }

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

  /** Proposer pubkey from the head state for builder preference validation. */
  getHeadProposerPubkey(slot: Slot): Uint8Array {
    return this.pubkeyCache.getPubkeyBytesOrThrow(this.getHeadState().getBeaconProposer(slot));
  }

  /** Source: unstable@2593063a82 sync/range/range.ts#addPeerOrCreateChain. */
  getHeadParentPayload(): HeadParentPayload | undefined {
    const headState = this.getHeadState();
    if (!isStatePostGloas(headState) || headState.latestBlockHeader.slot === 0) return undefined;
    const header = ssz.phase0.BeaconBlockHeader.clone(headState.latestBlockHeader);
    if (byteArrayEquals(header.stateRoot, ssz.Root.defaultValue())) header.stateRoot = headState.hashTreeRoot();
    const headRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(header);
    const headSlot = headState.latestBlockHeader.slot;
    return structuredClone({
      blockRoot: headRoot,
      blockRootHex: toRootHex(headRoot),
      slot: headSlot,
      proposerIndex: headState.latestBlockHeader.proposerIndex,
      forkName: this.config.getForkName(headSlot),
      bid: (headState as IBeaconStateViewGloas).latestExecutionPayloadBid,
    });
  }

  /** Subset of `indices` that are active-or-pending at the current epoch (builder registration filter). */
  getActiveOrPendingValidators(indices: ValidatorIndex[]): Set<ValidatorIndex> {
    const state = this.getHeadState();
    const currentEpoch = this.clock.currentEpoch;
    const kept = new Set<ValidatorIndex>();
    for (const index of indices) {
      if (index >= state.validatorCount) continue;
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

  /** Runs inside BeaconEngineCore. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/chain.ts#produceProposerSlashing. */
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
        const verifiedDomain = await proposerSlashingValidation.validateApiProposerSlashing.call(
          this,
          proposerSlashing
        );
        this.opPool.insertProposerSlashing(proposerSlashing, verifiedDomain);
      } catch (e) {
        this.logger.debug("Produced proposer slashing is not valid", {slot: blockSlot, proposerIndex}, e as Error);
        return;
      }

      this.emitter.emit(BeaconEngineEvent.proposerSlashingProduced, proposerSlashing);
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

  /** Runs inside BeaconEngineCore. Moved from unstable@6fb6c0bad4 packages/beacon-node/src/chain/chain.ts#processProposerEquivocation. */
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

      this.emitter.emit(BeaconEngineEvent.headUpdated, {
        slot: head.slot,
        blockRoot: head.blockRoot,
        stateRoot: head.stateRoot,
        payloadStatus: head.payloadStatus,
        headRootChanged,
        epochTransition,
        previousDutyDependentRoot,
        currentDutyDependentRoot,
        executionOptimistic,
      });
    } catch (e) {
      // getDependentRoot() may fail with error: "No block for root" as we can see in holesky non-finality issue
      this.logger.debug(
        "Error emitting head update",
        {slot: head.slot, root: head.blockRoot, headRootChanged},
        e as Error
      );
    }
  }
}

export {type StateValidatorIndexResponse, getStateBuilderIndex, getStateValidatorIndex} from "./beaconApis.js";
