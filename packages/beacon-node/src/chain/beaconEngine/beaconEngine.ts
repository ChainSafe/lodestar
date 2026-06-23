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
  PayloadExecutionStatus,
  ProtoBlock,
  UpdateHeadOpt,
  getSafeExecutionBlockHash,
} from "@lodestar/fork-choice";
import {
  ForkName,
  ForkPostAltair,
  ForkPostElectra,
  ForkSeq,
  GENESIS_SLOT,
  MAX_SEED_LOOKAHEAD,
  SLOTS_PER_EPOCH,
  isForkPostGloas,
} from "@lodestar/params";
import {
  DataAvailabilityStatus,
  EffectiveBalanceIncrements,
  EpochShuffling,
  IBeaconStateView,
  PubkeyCache,
  RootCache,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  computeTimeAtSlot,
  isStatePostAltair,
  isStatePostBellatrix,
  isStatePostCapella,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {
  Attestation,
  BLSSignature,
  BeaconBlock,
  Bytes32,
  Epoch,
  IndexedAttestation,
  Root,
  RootHex,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  Slot,
  SubnetID,
  ValidatorIndex,
  altair,
  deneb,
  electra,
  fulu,
  gloas,
  isGloasBeaconBlock,
  phase0,
  ssz,
} from "@lodestar/types";
import {Logger, fromHex, toRootHex} from "@lodestar/utils";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../constants/index.js";
import {IBeaconDb} from "../../db/index.js";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {callInNextEventLoop} from "../../util/eventLoop.js";
import {isOptimisticBlock} from "../../util/forkChoice.js";
import {CheckpointBalancesCache} from "../balancesCache.js";
import {isBlockInputBlobs, isBlockInputColumns} from "../blocks/blockInput/blockInput.js";
import {IBlockInput} from "../blocks/blockInput/index.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {AttestationImportOpt, ImportBlockOpts} from "../blocks/types.js";
import {getCheckpointFromState} from "../blocks/utils/checkpoint.js";
import {verifyBlocksSignatures} from "../blocks/verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "../blocks/verifyBlocksStateTransitionOnly.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {ChainEvent, ChainEventEmitter, ReorgEventData} from "../emitter.js";
import {BlockError, BlockErrorCode} from "../errors/index.js";
import {ForkchoiceCaller, initializeForkChoice} from "../forkChoice/index.js";
import {CommonBlockBody, FindHeadFnName} from "../interface.js";
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
import {BlockProcessOpts} from "../options.js";
import {
  BlockAttributes,
  BlockProductionStep,
  BlockType,
  PayloadAttributesWithdrawals,
} from "../produceBlock/produceBlockBody.js";
import {QueuedStateRegenerator, RegenCaller} from "../regen/index.js";
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
import {ShufflingCache} from "../shufflingCache.js";
import {FIFOBlockStateCache} from "../stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache, toCheckpointHex} from "../stateCache/persistentCheckpointsCache.js";
import {BlockStateCache, CheckpointStateCache} from "../stateCache/types.js";
import {
  AggregateAndProofValidationResult,
  validateApiAggregateAndProof,
  validateGossipAggregateAndProof,
} from "../validation/aggregateAndProof.js";
import {
  ApiAttestation,
  AttestationValidationResult,
  GossipAttestation,
  validateApiAttestation,
  validateGossipAttestationsSameAttData,
} from "../validation/attestation.js";
import {validateGossipBlobSidecar} from "../validation/blobSidecar.js";
import {GossipBlockValidationResult, validateGossipBlock} from "../validation/block.js";
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
import {validateApiSyncCommittee, validateGossipSyncCommittee} from "../validation/syncCommittee.js";
import {validateSyncCommitteeGossipContributionAndProof} from "../validation/syncCommitteeContributionAndProof.js";
import {ValidatorMonitor} from "../validatorMonitor.js";
import {GossipValidationResult, fromResult, runGossipValidation} from "./gossipValidationResult.js";
import {BeaconEngineModules, IBeaconEngine, ImportBlockResult, ProduceBlockBaseResult} from "./interface.js";
import {IBeaconEngineOptions} from "./options.js";

type VerifiedBlockBundle = {
  postState: IBeaconStateView;
  blockInput: IBlockInput;
  indexedAttestations: IndexedAttestation[];
  proposerBalanceDelta: number;
  parentBlockSlot: number;
  seenTimestampSec: number;
};

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

  // Consensus gossip seen-caches
  readonly seenAttesters = new SeenAttesters();
  readonly seenAggregators = new SeenAggregators();
  readonly seenPayloadAttesters = new SeenPayloadAttesters();
  readonly seenSyncCommitteeMessages = new SeenSyncCommitteeMessages();
  readonly seenContributionAndProof: SeenContributionAndProof;
  readonly seenAttestationDatas: SeenAttestationDatas;
  readonly seenBlockProposers = new SeenBlockProposers();
  readonly seenAggregatedAttestations: SeenAggregatedAttestations;
  readonly seenExecutionPayloadBids = new SeenExecutionPayloadBids();
  readonly seenProposerPreferences = new SeenProposerPreferences();

  // TODO - beacon engine: how to remove this?
  readonly seenBlockInputCache: SeenBlockInput;
  readonly validatorMonitor: ValidatorMonitor | null;
  // Engine reads execution payload envelopes for block production (getParentExecutionRequests). Writes
  // / archival / network handlers still use the shared `db` directly until the DB-ownership phase.
  readonly db: IBeaconDb;
  lightClientServer: LightClientServer | undefined;
  private readonly verifiedBlocks = new Map<string, VerifiedBlockBundle>();
  private readonly emitter: ChainEventEmitter;

  constructor(modules: BeaconEngineModules, anchorState: IBeaconStateView) {
    const {
      opts,
      config,
      logger,
      metrics,
      clock,
      pubkeyCache,
      bufferPool,
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
    this.metrics = metrics;
    this.clock = clock;
    this.pubkeyCache = pubkeyCache;
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

    this.seenContributionAndProof = new SeenContributionAndProof(metrics);
    this.seenAttestationDatas = new SeenAttestationDatas(metrics, opts?.attDataCacheSlotDistance);
    this.seenAggregatedAttestations = new SeenAggregatedAttestations(metrics);

    this.blockStateCache = new FIFOBlockStateCache(opts, {metrics});
    this.checkpointStateCache = new PersistentCheckpointStateCache(
      {config, metrics, logger, clock, blockStateCache: this.blockStateCache, bufferPool, datastore: cpStateDatastore},
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

  /** DB read of an execution payload envelope. Callers that hold the DA cache check it first. */
  async getExecutionPayloadEnvelope(
    blockSlot: Slot,
    blockRootHex: string
  ): Promise<gloas.SignedExecutionPayloadEnvelope | null> {
    return (
      (await this.db.executionPayloadEnvelope.get(fromHex(blockRootHex))) ??
      (await this.db.executionPayloadEnvelopeArchive.get(blockSlot)) ??
      null
    );
  }

  /**
   * Parent execution requests for block production. DB-only: the facade-owned DA cache is not visible
   * here, so callers that need cache-only (DB-write-pending) envelopes check the cache first
   * (`chain.getParentExecutionRequests`). At `produceBlockBase` time the parent is FULL and its
   * envelope's async DB write has normally completed.
   */
  async getParentExecutionRequests(
    parentBlockSlot: Slot,
    parentBlockRootHex: RootHex
  ): Promise<gloas.ExecutionRequests> {
    // at the fork boundary, parent is pre-gloas
    if (!isForkPostGloas(this.config.getForkName(parentBlockSlot))) {
      return ssz.gloas.ExecutionRequests.defaultValue();
    }
    const envelope = await this.getExecutionPayloadEnvelope(parentBlockSlot, parentBlockRootHex);
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
    return runGossipValidation(() => validateGossipBlock(this, signedBlock, fork));
  }

  validateGossipSyncCommittee(
    _syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<GossipValidationResult<{indicesInSubcommittee: number[]}>> {
    return runGossipValidation(() => validateGossipSyncCommittee(this, syncCommittee, subnet));
  }

  validateApiSyncCommittee(
    headState: IBeaconStateView,
    syncCommittee: altair.SyncCommitteeMessage
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() => validateApiSyncCommittee(this, headState, syncCommittee));
  }

  validateSyncCommitteeGossipContributionAndProof(
    _contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants = false
  ): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
    return runGossipValidation(() =>
      validateSyncCommitteeGossipContributionAndProof(this, signedContributionAndProof, skipValidationKnownParticipants)
    );
  }

  validateGossipBlobSidecar(
    _blobBytes: Uint8Array,
    fork: ForkName,
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() => validateGossipBlobSidecar(this, fork, blobSidecar, subnet));
  }

  validateGossipFuluDataColumnSidecar(
    _dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateGossipFuluDataColumnSidecar(this, dataColumnSidecar, gossipSubnet, this.metrics)
    );
  }

  validateGossipGloasDataColumnSidecar(
    _dataColumnBytes: Uint8Array,
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateGossipGloasDataColumnSidecar(this, payloadInput, dataColumnSidecar, gossipSubnet, this.metrics)
    );
  }

  validateGossipPayloadAttestationMessage(
    _payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<PayloadAttestationValidationResult>> {
    return runGossipValidation(() => validateGossipPayloadAttestationMessage(this, payloadAttestationMessage));
  }

  validateApiPayloadAttestationMessage(
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<GossipValidationResult<PayloadAttestationValidationResult>> {
    return runGossipValidation(() => validateApiPayloadAttestationMessage(this, payloadAttestationMessage));
  }

  // The batch attestation validator already returns `Result<T>[]` (caught internally, never throws out);
  // map each item to a `GossipValidationResult` so the batch is FFI-safe too. Per-item bytes live on each
  // `GossipAttestation.serializedData`, so there is no separate leading bytes parameter here.
  async validateGossipAttestationsSameAttData(
    fork: ForkName,
    attestations: GossipAttestation[]
  ): Promise<{results: GossipValidationResult<AttestationValidationResult>[]; batchableBls: boolean}> {
    const {results, batchableBls} = await validateGossipAttestationsSameAttData(fork, this, attestations);
    return {results: results.map(fromResult), batchableBls};
  }

  validateApiAttestation(
    fork: ForkName,
    attestationOrBytes: ApiAttestation
  ): Promise<GossipValidationResult<AttestationValidationResult>> {
    return runGossipValidation(() => validateApiAttestation(fork, this, attestationOrBytes));
  }

  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<AggregateAndProofValidationResult>> {
    return runGossipValidation(() =>
      validateGossipAggregateAndProof(fork, this, signedAggregateAndProof, aggregateBytes)
    );
  }

  validateApiAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<GossipValidationResult<AggregateAndProofValidationResult>> {
    return runGossipValidation(() => validateApiAggregateAndProof(fork, this, signedAggregateAndProof));
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
      validateGossipExecutionPayloadEnvelope(
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
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
    proposerIndex: ValidatorIndex,
    bidBuilderIndex: ValidatorIndex,
    bidBlockHashHex: RootHex,
    bidExecutionRequestsRoot: Root
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() =>
      validateApiExecutionPayloadEnvelope(
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
    return runGossipValidation(() => validateGossipExecutionPayloadBid(this, signedExecutionPayloadBid));
  }

  validateApiExecutionPayloadBid(
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
    return runGossipValidation(() => validateApiExecutionPayloadBid(this, signedExecutionPayloadBid));
  }

  validateGossipProposerPreferences(
    _preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<GossipValidationResult<void>> {
    return runGossipValidation(() => validateGossipProposerPreferences(this, signedProposerPreferences));
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
    const attestationsResult: {blockEpoch: number; attestingIndices: number[]}[] = [];

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

          attestationsResult.push({blockEpoch, attestingIndices: Array.from(indexedAttestation.attestingIndices)});

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
      attestations: attestationsResult,
      blockMeta: {
        slot: blockSlot,
        blockRootHex,
        proposerBalanceDelta,
        parentBlockSlot,
        seenTimestampSec,
      },
    };
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
