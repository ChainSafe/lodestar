import type {PubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {CompactMultiProof} from "@chainsafe/persistent-merkle-tree";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {
  CheckpointWithHex,
  EpochDifference,
  ForkChoiceStateGetter,
  IForkChoice,
  PayloadExecutionStatus,
  PayloadStatus,
  ProtoBlock,
  ProtoNode,
  UpdateHeadOpt,
} from "@lodestar/fork-choice";
import type {LoggerNode} from "@lodestar/logger/node";
import {
  EPOCHS_PER_HISTORICAL_VECTOR,
  ForkName,
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
  getCurrentEpoch,
  getEffectiveBalancesFromStateBytes,
  getIndexedAttestation,
  isStatePostAltair,
  isStatePostBellatrix,
  isStatePostCapella,
  isStatePostElectra,
  isStatePostFulu,
  isStatePostGloas,
  proposerShufflingDecisionRoot,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BLSPubkey,
  BeaconBlock,
  BlindedBeaconBlock,
  BuilderIndex,
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
  getBuilderStatus,
  getValidatorStatus,
  gloas,
  phase0,
  rewards,
  ssz,
} from "@lodestar/types";
import {Logger, byteArrayEquals, fromHex, isErrorAborted, sleep, toRootHex} from "@lodestar/utils";
import {ApiError, NodeIsSyncing} from "../../api/impl/errors.js";
import {GENESIS_EPOCH, ZERO_HASH} from "../../constants/index.js";
import {IBeaconEngineDb} from "../../db/index.js";
import {BuilderApiClient} from "../../execution/builder/apiClient.js";
import {BuilderStatus} from "../../execution/builder/http.js";
import {IExecutionBuilder, IExecutionEngine} from "../../execution/index.js";
import {Metrics} from "../../metrics/index.js";
import {BufferPool} from "../../util/bufferPool.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {isQueueErrorAborted} from "../../util/queue/index.js";
import {BlockRootSlot, getSlotFromSignedBeaconBlockSerialized} from "../../util/sszBytes.js";
import {HistoricalStateRegen} from "../archiveStore/historicalState/historicalStateRegen.js";
import {ArchiveMode, StateArchiveStrategy} from "../archiveStore/interface.js";
import {FrequencyStateArchiveStrategy} from "../archiveStore/strategies/frequencyStateArchiveStrategy.js";
import {
  migrateBlocksFromHotToColdDb,
  persistOrphanedBlock,
  pruneFinalizedExecutionRequests,
} from "../archiveStore/utils/archiveBlocks.js";
import {pruneHistory} from "../archiveStore/utils/pruneHistory.js";
import {CheckpointBalancesCache} from "../balancesCache.js";
import {BeaconProposerCache, ProposerPreparationData} from "../beaconProposerCache.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {ImportBlockOpts} from "../blocks/types.js";
import {SegmentExecStatus} from "../blocks/verifyBlocksExecutionPayloads.js";
import {verifyExecutionPayloadEnvelope as verifyEnvelopeFields} from "../blocks/verifyExecutionPayloadEnvelope.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {BuilderCircuitBreaker} from "../builderCircuitBreaker.js";
import {ChainViewSnapshot} from "../chainView/interface.js";
import {ChainEvent, ChainEventEmitter} from "../emitter.js";
import {ForkchoiceCaller, initializeForkChoice} from "../forkChoice/index.js";
import {CommonBlockBody, FindHeadFnName, StateGetOpts} from "../interface.js";
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
  SeenBlockInput,
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
import {ValidatorMonitor} from "../validatorMonitor.js";
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
import {importExecutionPayload, verifyExecutionPayloadEnvelope} from "./importExecutionPayload.js";
import type {ApiStateId} from "./interface.js";
import {
  ApiStateResult,
  ApiStateResultWithFork,
  BeaconEngineErrorCode,
  BeaconEngineModules,
  FinalizedBlockSnapshot,
  FinalizedProtoSummary,
  IBeaconEngine,
  ImportBlockResult,
  PrepareNextSlotResponse,
  ProduceBlockRequest,
  ProduceBlockResponse,
  ProduceBlockV4Request,
  ProduceBlockV4Response,
} from "./interface.js";
import {IBeaconEngineOptions} from "./options.js";
import {prepareForNextSlot} from "./prepareNextSlot.js";
import {produceBlockWrapper, produceCommonBlockBody} from "./produceBlock.js";
import {produceBlockV4, produceEngineOrBuilderBlock} from "./produceEngineOrBuilderBlock.js";
import {verifyBlocks} from "./verifyBlock.js";

/**
 * JS implementation of the consensus engine. Transitional in Phase 0: constructed inside
 * `BeaconChain` from the `anchorState` object; construction moves to the CLI in Phase 6.
 *
 * Minimal by design — collaborators, state ownership and flows migrate here in later phases.
 */
export class BeaconEngine implements IBeaconEngine {
  readonly config: BeaconConfig;
  readonly opts: IBeaconEngineOptions;
  readonly logger: Logger;
  readonly metrics: Metrics | null;
  readonly clock: IClock;
  readonly genesisTime: number;
  readonly pubkeyCache: PubkeyCache;
  // NodeJS-specific memory pool for state serialization; engine-internal (not on IBeaconEngine).
  readonly bufferPool: BufferPool;
  readonly bls: IBlsVerifier;
  readonly shufflingCache: ShufflingCache;

  readonly blockStateCache: BlockStateCache;
  readonly checkpointStateCache: CheckpointStateCache;
  readonly checkpointBalancesCache: CheckpointBalancesCache;
  readonly events = new BeaconEngineEventBus();
  private chainViewPublisher?: ChainViewPublisher;

  getChainViewSnapshot(): ChainViewSnapshot {
    this.chainViewPublisher ??= new ChainViewPublisher(this.forkChoice);
    return this.chainViewPublisher.snapshot();
  }

  publishChainView(blocksChanged = true): void {
    const update = this.chainViewPublisher?.update(blocksChanged);
    if (update) this.events.emit(BeaconEngineEvent.chainViewUpdated, update);
  }

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
  // Liveness cache: attesters seen through imported blocks (populated during block import).
  readonly seenBlockAttesters = new SeenBlockAttesters();
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenExecutionPayloadBids = new SeenExecutionPayloadBids();

  // TODO - beacon engine: how to remove this?
  readonly seenBlockInputCache: SeenBlockInput;
  readonly validatorMonitor: ValidatorMonitor | null;
  // Engine owns execution requests; envelope persistence and serving remain facade-owned.
  readonly db: IBeaconEngineDb;
  // Engine owns state archival (states DB). Finalized-state archive runs inside migrateFinalized; the
  // facade delegates temp-state (onCheckpoint) and shutdown persistence to engine methods.
  private readonly stateArchiveStrategy: StateArchiveStrategy;
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
  readonly builderApiClient: BuilderApiClient;
  readonly builderCircuitBreaker: BuilderCircuitBreaker;
  readonly deferredVoluntaryExitPool: DeferredVoluntaryExitPool;
  private readonly producingProposerSlashing = new Set<ValidatorIndex>();
  readonly executionBuilder?: IExecutionBuilder;

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
    this.genesisTime = anchorState.genesisTime;
    this.deferredVoluntaryExitPool = new DeferredVoluntaryExitPool(logger);
    this.pubkeyCache = pubkeyCache;
    // Engine owns the buffer pool; sized from the anchor state (NodeJS-specific, engine-internal).
    this.bufferPool = new BufferPool(anchorState.serializedSize(), metrics);
    this.seenBlockInputCache = seenBlockInputCache;
    this.validatorMonitor = validatorMonitor;
    this.lightClientServer = modules.lightClientServer;
    this.emitter = emitter;
    // Warm the shuffling cache on each checkpoint — engine-internal (re-fetches the checkpoint state from
    // regen, so no IBeaconStateView crosses the seam on the event).
    this.emitter.addListener(ChainEvent.checkpoint, this.onCheckpoint.bind(this));

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

  // --- TODO - beacon engine: temp forkChoice read pass-throughs (curate when regen removed — BLK-3). ---
  getHead(): ProtoBlock {
    return this.forkChoice.getHead();
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
  getFastConfirmationStore(): ReturnType<IBeaconEngine["getFastConfirmationStore"]> {
    return this.forkChoice.getFastConfirmationStore();
  }

  pauseFastConfirmation(): void {
    this.forkChoice.pauseFastConfirmation();
  }
  resumeFastConfirmation(): void {
    this.forkChoice.resumeFastConfirmation();
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
  getBlockHexAndBlockHash(blockRoot: RootHex, blockHash: RootHex): ProtoBlock | null {
    return this.forkChoice.getBlockHexAndBlockHash(blockRoot, blockHash);
  }
  getAllNodes(): ProtoNode[] {
    return this.forkChoice.getAllNodes();
  }
  // --- Block DB (engine-owned). Bytes-only; no SignedBeaconBlock crosses the seam. ---

  /** Serialized block by root: hot then cold. `finalized` reflects a cold-db (archive) hit. */
  /** Hot-only read for DA cache reloads; never substitutes an archived block. */
  async getSerializedUnfinalizedBlockByRoot(root: Uint8Array): Promise<Uint8Array | null> {
    return this.db.block.getBinary(root);
  }

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
  async getFinalizedBlockRootBySlot(slot: Slot): Promise<Root | null> {
    return this.db.blockArchive.getRootBySlot(slot);
  }

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
   * Moved from unstable@551b8b0a3d chain/chain.ts#getParentExecutionRequests.
   * [beacon-engine] deviation: read engine-owned requests (kept until the parent is finalized away)
   * instead of the facade envelope.
   */
  async getParentExecutionRequests(
    parentBlockSlot: Slot,
    parentBlockRootHex: RootHex
  ): Promise<gloas.ExecutionRequests> {
    // at the fork boundary, parent is pre-gloas
    if (!isForkPostGloas(this.config.getForkName(parentBlockSlot))) {
      return ssz.gloas.ExecutionRequests.defaultValue();
    }
    const requests = await this.db.executionRequests.get(fromHex(parentBlockRootHex));
    if (requests === null) {
      throw Error(`Parent execution requests not found slot=${parentBlockSlot}, root=${parentBlockRootHex}`);
    }
    return requests;
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

  isDescendant(
    root: RootHex,
    status: PayloadStatus,
    descendantRoot: RootHex,
    descendantStatus: PayloadStatus
  ): boolean {
    return this.forkChoice.isDescendant(root, status, descendantRoot, descendantStatus);
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
      this.logger.error(
        "Consensus checks failed while publishing execution payload envelope",
        {slot, blockRoot: blockRootHex},
        e as Error
      );
      throw new ApiError(400, (e as Error).message);
    }
  }

  isBlockProposerSeen(slot: Slot, proposerIndex: ValidatorIndex): boolean {
    return this.seenBlockProposers.isKnown(slot, proposerIndex);
  }

  async verifyBlocks(
    _blockBytes: Uint8Array[],
    parentBlock: ProtoBlock,
    blockInputs: IBlockInput[],
    opts: BlockProcessOpts & ImportBlockOpts,
    signal: AbortSignal
  ): Promise<{segmentExecStatus: SegmentExecStatus; verifyStateTime: number; verifySignaturesTime: number}> {
    try {
      return await verifyBlocks.call(this, _blockBytes, parentBlock, blockInputs, opts, signal);
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
    return verifyExecutionPayloadEnvelope.call(this, _envelopeBytes, signedEnvelope, proposerIndex, opts);
  }

  /**
   * Import a verified execution payload envelope into fork choice (transitions the block's PENDING
   * variant to FULL) and queue the post-import FCU. The facade awaits `notifyNewPayload` before
   * this call and emits events afterward. `execStatus` is the EL result mapped facade-side;
   * `blockRoot` is bytes-first (native FFI).
   * Runs inside BeaconEngine. FCU dispatch moved from unstable@551b8b0a3d
   * chain/blocks/importExecutionPayload.ts#importExecutionPayload; fork choice import uses the branch's bytes-first contract.
   */
  async importExecutionPayload(
    blockRoot: Root,
    blockHashHex: RootHex,
    payloadBlockNumber: number,
    payloadGasLimit: number,
    executionRequests: gloas.ExecutionRequests,
    execStatus: PayloadExecutionStatus,
    dataAvailabilityStatus: DataAvailabilityStatus
  ): Promise<{executionOptimistic: boolean}> {
    return importExecutionPayload.call(
      this,
      blockRoot,
      blockHashHex,
      payloadBlockNumber,
      payloadGasLimit,
      executionRequests,
      execStatus,
      dataAvailabilityStatus
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

  getIrrecoverableError(): Error | undefined {
    return this.forkChoice.irrecoverableError;
  }

  // --- DB ownership (blocks + states + execution requests) ---

  /** TODO - beacon engine (codex_beacon_engine_worker.md Task 8): retain these ordered persistence operations across the worker seam. */
  getFinalizedBlockSnapshot(root: RootHex): FinalizedBlockSnapshot {
    const {ancestors, nonAncestors} = this.forkChoice.getAllAncestorAndNonAncestorBlocksDefaultStatus(root);
    return {canonical: ancestors.map(toFinalizedProtoSummary), nonCanonical: nonAncestors.map(toFinalizedProtoSummary)};
  }
  async migrateCanonicalBlocks(blocks: BlockRootSlot[]): Promise<Slot[]> {
    return migrateBlocksFromHotToColdDb(this.db, this.logger, blocks);
  }
  async persistOrphanedBlocks(blocks: FinalizedProtoSummary[], directory?: string): Promise<void> {
    await Promise.all(
      blocks.map(async (block) => {
        const bytes = await this.db.block.getBinary(fromHex(block.blockRoot));
        if (bytes)
          await persistOrphanedBlock(block.slot, block.blockRoot, bytes, {
            persistOrphanedBlocksDir: directory ?? this.opts.persistOrphanedBlocksDir ?? "orphaned_blocks",
          });
        else
          this.logger.warn("Tried to persist orphaned block but no block found", {
            slot: block.slot,
            block: block.blockRoot,
          });
      })
    );
  }
  async deleteNonCanonicalBlocks(roots: Uint8Array[]): Promise<void> {
    await this.db.block.batchDelete(roots);
  }
  async completeFinalization(finalized: CheckpointWithHex): Promise<number> {
    await this.stateArchiveStrategy.onFinalizedCheckpoint(finalized, this.metrics);
    await this.stateArchiveStrategy.maybeArchiveState(finalized, this.metrics);
    await pruneFinalizedExecutionRequests(this.db, this.getFinalizedBlockSnapshot(finalized.rootHex));
    const count = this.forkChoice.prune(finalized.rootHex).length;
    this.publishChainView();
    return count;
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

  /** Prune finalized blocks + states below the retention window (engine-owned block/state DB). */
  async pruneHistory(finalizedEpoch: Epoch, currentEpoch: Epoch): Promise<Slot> {
    return pruneHistory(this.config, this.db, this.logger, this.metrics, finalizedEpoch, currentEpoch);
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

  /** Validator-monitor end-of-epoch hook against the head state (facade clock listener drives the timing). */
  validatorMonitorOnceEveryEndOfEpoch(): void {
    this.validatorMonitor?.onceEveryEndOfEpoch(this.getHeadState());
  }

  /** Whether regen can accept more work (backpressure). */
  regenCanAcceptWork(): boolean {
    return this.regen.canAcceptWork();
  }

  /**
   * The shared JS BLS verifier for the facade's backfill + DA-sidecar proposer-signature checks.
   * NodeJS shares one instance with the engine's internal verification; the Zig engine returns a
   * separate JS verifier here (see IBeaconEngine.chainBls).
   */
  chainBls(): IBlsVerifier {
    return this.bls;
  }

  /** Whether the engine's internal (gossip/import) BLS pool can accept more work (backpressure). */
  blsCanAcceptWork(): boolean {
    return this.bls.canAcceptWork();
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
          nativeStateView: this.opts.nativeStateView ?? false,
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
    await this.historicalStateRegen?.close();
    await this.bls.close();
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
    id: ApiStateId
  ): Promise<{state: IBeaconStateView | Uint8Array; executionOptimistic: boolean; finalized: boolean} | null> {
    if (typeof id === "object" && "head" in id) {
      const head = this.forkChoice.getHead();
      const state = this.regen.getStateSync(head.stateRoot) ?? this.getHeadState();
      const finalizedEpoch = this.forkChoice.getFinalizedCheckpoint().epoch;
      return {
        state,
        executionOptimistic: isOptimisticBlock(head),
        finalized: state.epoch <= finalizedEpoch && finalizedEpoch !== GENESIS_EPOCH,
      };
    }
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
    id: ApiStateId
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
    id: ApiStateId
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
    id: ApiStateId,
    descriptor: Uint8Array
  ): Promise<{proof: CompactMultiProof; fork: ForkName} | null> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) {
      return null;
    }
    return {proof: res.state.createMultiProof(descriptor), fork: this.config.getForkName(res.state.slot)};
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

  async getStateBuilders(
    id: ApiStateId,
    builderIds: routes.beacon.BuilderId[],
    statuses: string[]
  ): Promise<ApiStateResult<routes.beacon.BuilderResponse[]>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    if (!isStatePostGloas(state)) {
      return {invalid: {code: 400, message: `Builders are not supported for pre-gloas state fork=${state.forkName}`}};
    }
    const finalizedEpoch = state.finalizedCheckpoint.epoch;

    const builderResponses: routes.beacon.BuilderResponse[] = [];
    if (builderIds.length) {
      for (const id of builderIds) {
        const resp = getStateBuilderIndex(id, state);
        if (resp.valid) {
          const builderIndex = resp.builderIndex;
          const builder = state.getBuilder(builderIndex);
          const status = getBuilderStatus(builder, finalizedEpoch);
          if (statuses.length && !statuses.includes(status)) {
            continue;
          }
          builderResponses.push({index: builderIndex, status, builder});
        }
      }
      return {
        data: builderResponses,
        executionOptimistic,
        finalized,
      };
    }

    if (statuses.length) {
    }

    const buildersLength = state.getBuildersLength();
    for (let builderIndex = 0; builderIndex < buildersLength; builderIndex++) {
      const builder = state.getBuilder(builderIndex);
      const status = getBuilderStatus(builder, finalizedEpoch);
      if (statuses.length && !statuses.includes(status)) {
        continue;
      }
      builderResponses.push({index: builderIndex, status, builder});
    }

    return {
      data: builderResponses,
      executionOptimistic,
      finalized,
    };
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

  async getStateRoot(id: ApiStateId): Promise<ApiStateResult<{root: Root}>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    return {
      data: {root: res.state.hashTreeRoot()},
      executionOptimistic: res.executionOptimistic,
      finalized: res.finalized,
    };
  }

  async getStateFork(id: ApiStateId): Promise<ApiStateResult<phase0.Fork>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    return {data: res.state.fork, executionOptimistic: res.executionOptimistic, finalized: res.finalized};
  }

  async getStateRandao(id: ApiStateId, epoch?: Epoch): Promise<ApiStateResult<{randao: Bytes32}>> {
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

  async getStateFinalityCheckpoints(id: ApiStateId): Promise<
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
    id: ApiStateId,
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
      const block = this.forkChoice.getCanonicalBlockClosestLteSlot(slot) ?? finalizedBlock;
      const state = await this.regen.getBlockSlotState(block, slot, {dontTransferCache: true}, RegenCaller.restApi);
      return {
        state,
        executionOptimistic: isOptimisticBlock(block),
        finalized: slot === finalizedBlock.slot && finalizedBlock.slot !== GENESIS_SLOT,
      };
    }

    const block = this.forkChoice.getCanonicalBlockAtSlot(slot);
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
        await validateApiProposerSlashing.call(this, proposerSlashing);
      } catch (e) {
        this.logger.debug("Produced proposer slashing is not valid", {slot: blockSlot, proposerIndex}, e as Error);
        return;
      }

      this.opPool.insertProposerSlashing(proposerSlashing);
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
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const fork = state.forkName;

    if (!isStatePostGloas(state)) {
      return {
        invalid: {code: 400, message: `Cannot retrieve pending builder payments for pre-gloas state fork=${fork}`},
      };
    }

    const builderPendingPayments = state.builderPendingPayments;

    return {
      data: returnBytes ? ssz.gloas.BuilderPendingPayments.serialize(builderPendingPayments) : builderPendingPayments,
      executionOptimistic,
      finalized,
      fork,
    };
  }

  async getBuilderPendingWithdrawals(
    id: ApiStateId,
    returnBytes: boolean
  ): Promise<ApiStateResultWithFork<Uint8Array | gloas.BuilderPendingWithdrawals>> {
    const res = await this.resolveStateViewForApi(id);
    if (!res) return null;
    const {state, executionOptimistic, finalized} = res;
    const fork = state.forkName;

    if (!isStatePostGloas(state)) {
      return {
        invalid: {code: 400, message: `Cannot retrieve pending builder withdrawals for pre-gloas state fork=${fork}`},
      };
    }

    const builderPendingWithdrawals = state.builderPendingWithdrawals;

    return {
      data: returnBytes
        ? ssz.gloas.BuilderPendingWithdrawals.serialize(builderPendingWithdrawals)
        : builderPendingWithdrawals,
      executionOptimistic,
      finalized,
      fork,
    };
  }

  /** Copy the recent canonical root ring before returning; do not expose or retain its state. */
  getRecentCanonicalRoots(startSlot: number, endSlot: number): Map<number, RootHex | null> {
    const roots = new Map<number, RootHex | null>();
    if (startSlot >= endSlot) return roots;
    const state = this.getHeadState();
    // Skipped slots repeat the prior root. At the oldest ring entry, that prior root is unavailable.
    const start = Math.max(startSlot, state.slot - SLOTS_PER_HISTORICAL_ROOT + 1, 1);
    const end = Math.min(endSlot, state.slot);
    if (start >= end) return roots;
    let previousRoot = toRootHex(state.getBlockRootAtSlot(start - 1));
    for (let slot = start; slot < end; slot++) {
      const root = toRootHex(state.getBlockRootAtSlot(slot));
      roots.set(slot, root === previousRoot ? null : root);
      previousRoot = root;
    }
    return roots;
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

/** Reduce a ProtoBlock to the plain scalars the facade needs for DA/light-client cleanup. */
function toFinalizedProtoSummary(block: ProtoBlock): FinalizedProtoSummary {
  return {
    slot: block.slot,
    blockRoot: block.blockRoot,
    payloadStatus: block.payloadStatus,
    executionStatus: block.executionStatus,
    timeliness: block.timeliness,
    importedTimely: block.importedTimely,
  };
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
    if (!Number.isSafeInteger(validatorIndex) || validatorIndex < 0) {
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

export function getStateBuilderIndex(
  id: routes.beacon.BuilderId | BLSPubkey,
  state: IBeaconStateViewGloas
): {valid: true; builderIndex: BuilderIndex} | {valid: false; code: number; reason: string} {
  if (typeof id === "string") {
    // mutate `id` and fallthrough to below
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
    const builderIndex = id;
    // builder is invalid or added later than given stateId
    if (!Number.isSafeInteger(builderIndex) || builderIndex < 0) {
      return {valid: false, code: 400, reason: "Invalid builder index"};
    }
    if (builderIndex >= state.getBuildersLength()) {
      return {valid: false, code: 404, reason: "Builder index from future state"};
    }
    return {valid: true, builderIndex};
  }

  // typeof id === Uint8Array
  // There is no builder pubkey cache, linear scan over the registry
  const buildersLength = state.getBuildersLength();
  for (let builderIndex = 0; builderIndex < buildersLength; builderIndex++) {
    if (byteArrayEquals(state.getBuilder(builderIndex).pubkey, id)) {
      return {valid: true, builderIndex};
    }
  }
  return {valid: false, code: 404, reason: "Builder pubkey not found in state"};
}
