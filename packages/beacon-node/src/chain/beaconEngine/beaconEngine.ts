import {BeaconConfig} from "@lodestar/config";
import {CheckpointWithHex, ForkChoiceStateGetter, IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {ForkName} from "@lodestar/params";
import {
  EffectiveBalanceIncrements,
  EpochShuffling,
  IBeaconStateView,
  PubkeyCache,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
} from "@lodestar/state-transition";
import {
  Epoch,
  RootHex,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SubnetID,
  ValidatorIndex,
  altair,
  deneb,
  fulu,
  gloas,
} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {Metrics} from "../../metrics/index.js";
import {IClock} from "../../util/clock.js";
import {CheckpointBalancesCache} from "../balancesCache.js";
import {PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput/index.js";
import {BlsMultiThreadWorkerPool, BlsSingleThreadVerifier, IBlsVerifier} from "../bls/index.js";
import {initializeForkChoice} from "../forkChoice/index.js";
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
import {QueuedStateRegenerator, RegenCaller} from "../regen/index.js";
import {
  SeenAggregators,
  SeenAttesters,
  SeenBlockInput,
  SeenBlockProposers,
  SeenContributionAndProof,
  SeenExecutionPayloadBids,
  SeenPayloadAttesters,
  SeenPayloadEnvelopeInput,
  SeenProposerPreferences,
  SeenSyncCommitteeMessages,
} from "../seenCache/index.js";
import {SeenAggregatedAttestations} from "../seenCache/seenAggregateAndProof.js";
import {SeenAttestationDatas} from "../seenCache/seenAttestationData.js";
import {ShufflingCache} from "../shufflingCache.js";
import {FIFOBlockStateCache} from "../stateCache/fifoBlockStateCache.js";
import {PersistentCheckpointStateCache} from "../stateCache/persistentCheckpointsCache.js";
import {BlockStateCache, CheckpointStateCache} from "../stateCache/types.js";
import {
  AggregateAndProofValidationResult,
  validateApiAggregateAndProof,
  validateGossipAggregateAndProof,
} from "../validation/aggregateAndProof.js";
import {
  ApiAttestation,
  AttestationValidationResult,
  BatchResult,
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
import {BeaconEngineModules, IBeaconEngine} from "./interface.js";
import {IBeaconEngineOptions} from "./options.js";

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

  // Facade-owned (DA assembly), shared with the engine. `seenBlockInputCache` is injected via the
  // constructor; `seenPayloadEnvelopeInputCache` is assigned by `BeaconChain` post-construction because
  // it depends on the engine's own `forkChoice`. TODO - beacon engine: revisit ownership in a later phase.
  readonly seenBlockInputCache: SeenBlockInput;
  seenPayloadEnvelopeInputCache!: SeenPayloadEnvelopeInput;

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
    this.metrics = metrics;
    this.clock = clock;
    this.pubkeyCache = pubkeyCache;
    this.seenBlockInputCache = seenBlockInputCache;

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

  // Gossip validation flows. Each method takes the message's SSZ bytes first (unused by this JS impl;
  // present for the native engine's bytes-first contract) and delegates to the validation logic in
  // `../validation/*` rebound onto the engine.
  validateGossipBlock(
    _blockBytes: Uint8Array,
    signedBlock: SignedBeaconBlock,
    fork: ForkName
  ): Promise<GossipBlockValidationResult> {
    return validateGossipBlock(this, signedBlock, fork);
  }

  validateGossipSyncCommittee(
    _syncCommitteeBytes: Uint8Array,
    syncCommittee: altair.SyncCommitteeMessage,
    subnet: SubnetID
  ): Promise<{indicesInSubcommittee: number[]}> {
    return validateGossipSyncCommittee(this, syncCommittee, subnet);
  }

  validateApiSyncCommittee(headState: IBeaconStateView, syncCommittee: altair.SyncCommitteeMessage): Promise<void> {
    return validateApiSyncCommittee(this, headState, syncCommittee);
  }

  validateSyncCommitteeGossipContributionAndProof(
    _contributionBytes: Uint8Array,
    signedContributionAndProof: altair.SignedContributionAndProof,
    skipValidationKnownParticipants = false
  ): Promise<{syncCommitteeParticipantIndices: ValidatorIndex[]}> {
    return validateSyncCommitteeGossipContributionAndProof(
      this,
      signedContributionAndProof,
      skipValidationKnownParticipants
    );
  }

  validateGossipBlobSidecar(
    _blobBytes: Uint8Array,
    fork: ForkName,
    blobSidecar: deneb.BlobSidecar,
    subnet: SubnetID
  ): Promise<void> {
    return validateGossipBlobSidecar(this, fork, blobSidecar, subnet);
  }

  validateGossipFuluDataColumnSidecar(
    _dataColumnBytes: Uint8Array,
    dataColumnSidecar: fulu.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<void> {
    return validateGossipFuluDataColumnSidecar(this, dataColumnSidecar, gossipSubnet, this.metrics);
  }

  validateGossipGloasDataColumnSidecar(
    _dataColumnBytes: Uint8Array,
    payloadInput: PayloadEnvelopeInput,
    dataColumnSidecar: gloas.DataColumnSidecar,
    gossipSubnet: SubnetID
  ): Promise<void> {
    return validateGossipGloasDataColumnSidecar(this, payloadInput, dataColumnSidecar, gossipSubnet, this.metrics);
  }

  validateGossipPayloadAttestationMessage(
    _payloadAttestationBytes: Uint8Array,
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult> {
    return validateGossipPayloadAttestationMessage(this, payloadAttestationMessage);
  }

  validateApiPayloadAttestationMessage(
    payloadAttestationMessage: gloas.PayloadAttestationMessage
  ): Promise<PayloadAttestationValidationResult> {
    return validateApiPayloadAttestationMessage(this, payloadAttestationMessage);
  }

  // The batch attestation validator's per-item bytes live on each `GossipAttestation.serializedData`,
  // so there is no separate leading bytes parameter here.
  validateGossipAttestationsSameAttData(fork: ForkName, attestations: GossipAttestation[]): Promise<BatchResult> {
    return validateGossipAttestationsSameAttData(fork, this, attestations);
  }

  validateApiAttestation(fork: ForkName, attestationOrBytes: ApiAttestation): Promise<AttestationValidationResult> {
    return validateApiAttestation(fork, this, attestationOrBytes);
  }

  validateGossipAggregateAndProof(
    aggregateBytes: Uint8Array,
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<AggregateAndProofValidationResult> {
    return validateGossipAggregateAndProof(fork, this, signedAggregateAndProof, aggregateBytes);
  }

  validateApiAggregateAndProof(
    fork: ForkName,
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<AggregateAndProofValidationResult> {
    return validateApiAggregateAndProof(fork, this, signedAggregateAndProof);
  }

  validateGossipExecutionPayloadEnvelope(
    _envelopeBytes: Uint8Array,
    executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope
  ): Promise<void> {
    return validateGossipExecutionPayloadEnvelope(this, executionPayloadEnvelope);
  }

  validateApiExecutionPayloadEnvelope(executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope): Promise<void> {
    return validateApiExecutionPayloadEnvelope(this, executionPayloadEnvelope);
  }

  validateGossipExecutionPayloadBid(
    _bidBytes: Uint8Array,
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<{proposerIndex: ValidatorIndex}> {
    return validateGossipExecutionPayloadBid(this, signedExecutionPayloadBid);
  }

  validateApiExecutionPayloadBid(
    signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
  ): Promise<{proposerIndex: ValidatorIndex}> {
    return validateApiExecutionPayloadBid(this, signedExecutionPayloadBid);
  }

  validateGossipProposerPreferences(
    _preferencesBytes: Uint8Array,
    signedProposerPreferences: gloas.SignedProposerPreferences
  ): Promise<void> {
    return validateGossipProposerPreferences(this, signedProposerPreferences);
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
