import {PublicKey} from "@chainsafe/blst";
import * as immutable from "immutable";
import {PubkeyIndexMap} from "@chainsafe/pubkey-index-map";
import {
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Slot,
  ValidatorIndex,
  phase0,
  RootHex,
  SyncPeriod,
  Attestation,
  IndexedAttestation,
  electra,
} from "@lodestar/types";
import {createBeaconConfig, BeaconConfig, ChainConfig} from "@lodestar/config";
import {
  ATTESTATION_SUBNET_COUNT,
  DOMAIN_BEACON_PROPOSER,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  ForkSeq,
  GENESIS_EPOCH,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  WEIGHT_DENOMINATOR,
} from "@lodestar/params";
import {LodestarError, fromHex} from "@lodestar/utils";
import {
  computeActivationExitEpoch,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getChurnLimit,
  isActiveValidator,
  isAggregatorFromCommitteeLength,
  computeSyncPeriodAtEpoch,
  getSeed,
  computeProposers,
  getActivationChurnLimit,
} from "../util/index.js";
import {
  computeEpochShuffling,
  EpochShuffling,
  calculateShufflingDecisionRoot,
  IShufflingCache,
} from "../util/epochShuffling.js";
import {computeBaseRewardPerIncrement, computeSyncParticipantReward} from "../util/syncCommittee.js";
import {sumTargetUnslashedBalanceIncrements} from "../util/targetUnslashedBalance.js";
import {getTotalSlashingsByIncrement} from "../epoch/processSlashings.js";
import {AttesterDuty, calculateCommitteeAssignments} from "../util/calculateCommitteeAssignments.js";
import {EpochCacheMetrics} from "../metrics.js";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsWithLen} from "./effectiveBalanceIncrements.js";
import {BeaconStateAllForks, BeaconStateAltair} from "./types.js";
import {
  Index2PubkeyCache,
  UnfinalizedPubkeyIndexMap,
  syncPubkeys,
  toMemoryEfficientHexStr,
  PubkeyHex,
  newUnfinalizedPubkeyIndexMap,
} from "./pubkeyCache.js";
import {
  computeSyncCommitteeCache,
  getSyncCommitteeCache,
  SyncCommitteeCache,
  SyncCommitteeCacheEmpty,
} from "./syncCommitteeCache.js";
import {CachedBeaconStateAllForks} from "./stateCache.js";

/** `= PROPOSER_WEIGHT / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)` */
export const PROPOSER_WEIGHT_FACTOR = PROPOSER_WEIGHT / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);

export type EpochCacheImmutableData = {
  config: BeaconConfig;
  pubkey2index: PubkeyIndexMap;
  index2pubkey: Index2PubkeyCache;
  shufflingCache?: IShufflingCache;
};

export type EpochCacheOpts = {
  skipSyncCommitteeCache?: boolean;
  skipSyncPubkeys?: boolean;
};

/** Defers computing proposers by persisting only the seed, and dropping it once indexes are computed */
type ProposersDeferred = {computed: false; seed: Uint8Array} | {computed: true; indexes: ValidatorIndex[]};

/**
 * EpochCache is the parent object of:
 * - Any data-structures not part of the spec'ed BeaconState
 * - Necessary to only compute data once
 * - Must be kept at all times through an epoch
 *
 * The performance gains with EpochCache are fundamental for the BeaconNode to be able to participate in a
 * production network with 100_000s of validators. In summary, it contains:
 *
 * Expensive data constant through the epoch:
 * - pubkey cache
 * - proposer indexes
 * - shufflings
 * - sync committee indexed
 * Counters (maybe) mutated through the epoch:
 * - churnLimit
 * - exitQueueEpoch
 * - exitQueueChurn
 * Time data faster than recomputing from the state:
 * - epoch
 * - syncPeriod
 **/
export class EpochCache {
  config: BeaconConfig;
  /**
   * Unique globally shared finalized pubkey registry. There should only exist one for the entire application.
   *
   * TODO: this is a hack, we need a safety mechanism in case a bad eth1 majority vote is in,
   * or handle non finalized data differently, or use an immutable.js structure for cheap copies
   *
   * New: This would include only validators whose activation_eligibility_epoch != FAR_FUTURE_EPOCH and hence it is
   * insert only. Validators could be 1) Active 2) In the activation queue 3) Initialized but pending queued
   *
   * $VALIDATOR_COUNT x 192 char String -> Number Map
   */
  pubkey2index: PubkeyIndexMap;
  /**
   * Unique globally shared finalized pubkey registry. There should only exist one for the entire application.
   *
   * New: This would include only validators whose activation_eligibility_epoch != FAR_FUTURE_EPOCH and hence it is
   * insert only. Validators could be 1) Active 2) In the activation queue 3) Initialized but pending queued
   *
   * $VALIDATOR_COUNT x BLST deserialized pubkey (Jacobian coordinates)
   */
  index2pubkey: Index2PubkeyCache;
  /**
   * Unique pubkey registry shared in the same fork. There should only exist one for the fork.
   */
  unfinalizedPubkey2index: UnfinalizedPubkeyIndexMap;
  /**
   * ShufflingCache is passed in from `beacon-node` so should be available at runtime but may not be
   * present during testing.
   */
  shufflingCache?: IShufflingCache;

  /**
   * Indexes of the block proposers for the current epoch.
   *
   * 32 x Number
   */
  proposers: ValidatorIndex[];

  /** Proposers for previous epoch, initialized to null in first epoch */
  proposersPrevEpoch: ValidatorIndex[] | null;

  /**
   * The next proposer seed is only used in the getBeaconProposersNextEpoch call. It cannot be moved into
   * getBeaconProposersNextEpoch because it needs state as input and all data needed by getBeaconProposersNextEpoch
   * should be in the epoch context.
   */
  proposersNextEpoch: ProposersDeferred;

  /**
   * Epoch decision roots to look up correct shuffling from the Shuffling Cache
   */
  previousDecisionRoot: RootHex;
  currentDecisionRoot: RootHex;
  nextDecisionRoot: RootHex;
  /**
   * Shuffling of validator indexes. Immutable through the epoch, then it's replaced entirely.
   * Note: Per spec definition, shuffling will always be defined. They are never called before loadState()
   *
   * $VALIDATOR_COUNT x Number
   */
  previousShuffling: EpochShuffling;
  /** Same as previousShuffling */
  currentShuffling: EpochShuffling;
  /** Same as previousShuffling */
  nextShuffling: EpochShuffling | null;
  /**
   * Cache nextActiveIndices so that in afterProcessEpoch the next shuffling can be build synchronously
   * in case it is not built or the ShufflingCache is not available
   */
  nextActiveIndices: Uint32Array;
  /**
   * Effective balances, for altair processAttestations()
   */
  effectiveBalanceIncrements: EffectiveBalanceIncrements;
  /**
   * Total state.slashings by increment, for processSlashing()
   */
  totalSlashingsByIncrement: number;
  syncParticipantReward: number;
  syncProposerReward: number;
  /**
   * Update freq: once per epoch after `process_effective_balance_updates()`
   */
  baseRewardPerIncrement: number;
  /**
   * Total active balance for current epoch, to be used instead of getTotalBalance()
   */
  totalActiveBalanceIncrements: number;

  /**
   * Rate at which validators can enter or leave the set per epoch. Depends only on activeIndexes, so it does not
   * change through the epoch. It's used in initiateValidatorExit(). Must be update after changing active indexes.
   */
  churnLimit: number;

  /**
   * Fork limited actual activationChurnLimit
   */
  activationChurnLimit: number;
  /**
   * Closest epoch with available churn for validators to exit at. May be updated every block as validators are
   * initiateValidatorExit(). This value may vary on each fork of the state.
   *
   * NOTE: Changes block to block
   * NOTE: No longer used by initiateValidatorExit post-electra
   */
  exitQueueEpoch: Epoch;
  /**
   * Number of validators initiating an exit at exitQueueEpoch. May be updated every block as validators are
   * initiateValidatorExit(). This value may vary on each fork of the state.
   *
   * NOTE: Changes block to block
   * NOTE: No longer used by initiateValidatorExit post-electra
   */
  exitQueueChurn: number;

  /**
   * Total cumulative balance increments through epoch for current target.
   * Required for unrealized checkpoints issue pull-up tips N+1. Otherwise must run epoch transition every block
   * This value is equivalent to:
   * - Forward current state to end-of-epoch
   * - Run beforeProcessEpoch
   * - epochTransitionCache.currEpochUnslashedTargetStakeByIncrement
   */
  currentTargetUnslashedBalanceIncrements: number;
  /**
   * Total cumulative balance increments through epoch for previous target.
   * Required for unrealized checkpoints issue pull-up tips N+1. Otherwise must run epoch transition every block
   * This value is equivalent to:
   * - Forward current state to end-of-epoch
   * - Run beforeProcessEpoch
   * - epochTransitionCache.prevEpochUnslashedStake.targetStakeByIncrement
   */
  previousTargetUnslashedBalanceIncrements: number;

  /** TODO: Indexed SyncCommitteeCache */
  currentSyncCommitteeIndexed: SyncCommitteeCache;
  /** TODO: Indexed SyncCommitteeCache */
  nextSyncCommitteeIndexed: SyncCommitteeCache;

  // TODO: Helper stats
  syncPeriod: SyncPeriod;
  /**
   * state.validators.length of every state at epoch boundary
   * They are saved in increasing order of epoch.
   * The first validator length in the list corresponds to the state AFTER the latest finalized checkpoint state. ie. state.finalizedCheckpoint.epoch - 1
   * The last validator length corresponds to the latest epoch state ie. this.epoch
   * eg. latest epoch = 105, latest finalized cp state epoch = 102
   * then the list will be (in terms of epoch) [103, 104, 105]
   */
  historicalValidatorLengths: immutable.List<number>;

  epoch: Epoch;

  get nextEpoch(): Epoch {
    return this.epoch + 1;
  }

  constructor(data: {
    config: BeaconConfig;
    pubkey2index: PubkeyIndexMap;
    index2pubkey: Index2PubkeyCache;
    unfinalizedPubkey2index: UnfinalizedPubkeyIndexMap;
    shufflingCache?: IShufflingCache;
    proposers: number[];
    proposersPrevEpoch: number[] | null;
    proposersNextEpoch: ProposersDeferred;
    previousDecisionRoot: RootHex;
    currentDecisionRoot: RootHex;
    nextDecisionRoot: RootHex;
    previousShuffling: EpochShuffling;
    currentShuffling: EpochShuffling;
    nextShuffling: EpochShuffling | null;
    nextActiveIndices: Uint32Array;
    effectiveBalanceIncrements: EffectiveBalanceIncrements;
    totalSlashingsByIncrement: number;
    syncParticipantReward: number;
    syncProposerReward: number;
    baseRewardPerIncrement: number;
    totalActiveBalanceIncrements: number;
    churnLimit: number;
    activationChurnLimit: number;
    exitQueueEpoch: Epoch;
    exitQueueChurn: number;
    currentTargetUnslashedBalanceIncrements: number;
    previousTargetUnslashedBalanceIncrements: number;
    currentSyncCommitteeIndexed: SyncCommitteeCache;
    nextSyncCommitteeIndexed: SyncCommitteeCache;
    epoch: Epoch;
    syncPeriod: SyncPeriod;
    historialValidatorLengths: immutable.List<number>;
  }) {
    this.config = data.config;
    this.pubkey2index = data.pubkey2index;
    this.index2pubkey = data.index2pubkey;
    this.unfinalizedPubkey2index = data.unfinalizedPubkey2index;
    this.shufflingCache = data.shufflingCache;
    this.proposers = data.proposers;
    this.proposersPrevEpoch = data.proposersPrevEpoch;
    this.proposersNextEpoch = data.proposersNextEpoch;
    this.previousDecisionRoot = data.previousDecisionRoot;
    this.currentDecisionRoot = data.currentDecisionRoot;
    this.nextDecisionRoot = data.nextDecisionRoot;
    this.previousShuffling = data.previousShuffling;
    this.currentShuffling = data.currentShuffling;
    this.nextShuffling = data.nextShuffling;
    this.nextActiveIndices = data.nextActiveIndices;
    this.effectiveBalanceIncrements = data.effectiveBalanceIncrements;
    this.totalSlashingsByIncrement = data.totalSlashingsByIncrement;
    this.syncParticipantReward = data.syncParticipantReward;
    this.syncProposerReward = data.syncProposerReward;
    this.baseRewardPerIncrement = data.baseRewardPerIncrement;
    this.totalActiveBalanceIncrements = data.totalActiveBalanceIncrements;
    this.churnLimit = data.churnLimit;
    this.activationChurnLimit = data.activationChurnLimit;
    this.exitQueueEpoch = data.exitQueueEpoch;
    this.exitQueueChurn = data.exitQueueChurn;
    this.currentTargetUnslashedBalanceIncrements = data.currentTargetUnslashedBalanceIncrements;
    this.previousTargetUnslashedBalanceIncrements = data.previousTargetUnslashedBalanceIncrements;
    this.currentSyncCommitteeIndexed = data.currentSyncCommitteeIndexed;
    this.nextSyncCommitteeIndexed = data.nextSyncCommitteeIndexed;
    this.epoch = data.epoch;
    this.syncPeriod = data.syncPeriod;
    this.historicalValidatorLengths = data.historialValidatorLengths;
  }

  /**
   * Create an epoch cache
   * @param state a finalized beacon state. Passing in unfinalized state may cause unexpected behaviour eg. empty unfinalized cache
   *
   * SLOW CODE - 🐢
   */
  static createFromState(
    state: BeaconStateAllForks,
    {config, pubkey2index, index2pubkey, shufflingCache}: EpochCacheImmutableData,
    opts?: EpochCacheOpts
  ): EpochCache {
    const currentEpoch = computeEpochAtSlot(state.slot);
    const isGenesis = currentEpoch === GENESIS_EPOCH;
    const previousEpoch = isGenesis ? GENESIS_EPOCH : currentEpoch - 1;
    const nextEpoch = currentEpoch + 1;

    let totalActiveBalanceIncrements = 0;
    let exitQueueEpoch = computeActivationExitEpoch(currentEpoch);
    let exitQueueChurn = 0;

    const validators = state.validators.getAllReadonlyValues();
    const validatorCount = validators.length;

    // syncPubkeys here to ensure EpochCacheImmutableData is popualted before computing the rest of caches
    // - computeSyncCommitteeCache() needs a fully populated pubkey2index cache
    if (!opts?.skipSyncPubkeys) {
      syncPubkeys(validators, pubkey2index, index2pubkey);
    }

    const effectiveBalanceIncrements = getEffectiveBalanceIncrementsWithLen(validatorCount);
    const totalSlashingsByIncrement = getTotalSlashingsByIncrement(state);
    const previousActiveIndicesAsNumberArray: ValidatorIndex[] = [];
    const currentActiveIndicesAsNumberArray: ValidatorIndex[] = [];
    const nextActiveIndicesAsNumberArray: ValidatorIndex[] = [];

    // BeaconChain could provide a shuffling cache to avoid re-computing shuffling every epoch
    // in that case, we don't need to compute shufflings again
    const previousDecisionRoot = calculateShufflingDecisionRoot(config, state, previousEpoch);
    const cachedPreviousShuffling = shufflingCache?.getSync(previousEpoch, previousDecisionRoot);
    const currentDecisionRoot = calculateShufflingDecisionRoot(config, state, currentEpoch);
    const cachedCurrentShuffling = shufflingCache?.getSync(currentEpoch, currentDecisionRoot);
    const nextDecisionRoot = calculateShufflingDecisionRoot(config, state, nextEpoch);
    const cachedNextShuffling = shufflingCache?.getSync(nextEpoch, nextDecisionRoot);

    for (let i = 0; i < validatorCount; i++) {
      const validator = validators[i];

      // Note: Not usable for fork-choice balances since in-active validators are not zero'ed
      effectiveBalanceIncrements[i] = Math.floor(validator.effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);

      // we only need to track active indices for previous, current and next epoch if we have to compute shufflings
      // skip doing that if we already have cached shufflings
      if (cachedPreviousShuffling == null && isActiveValidator(validator, previousEpoch)) {
        previousActiveIndicesAsNumberArray.push(i);
      }
      if (isActiveValidator(validator, currentEpoch)) {
        if (cachedCurrentShuffling == null) {
          currentActiveIndicesAsNumberArray.push(i);
        }
        // We track totalActiveBalanceIncrements as ETH to fit total network balance in a JS number (53 bits)
        totalActiveBalanceIncrements += effectiveBalanceIncrements[i];
      }
      if (cachedNextShuffling == null && isActiveValidator(validator, nextEpoch)) {
        nextActiveIndicesAsNumberArray.push(i);
      }

      const {exitEpoch} = validator;
      if (exitEpoch !== FAR_FUTURE_EPOCH) {
        if (exitEpoch > exitQueueEpoch) {
          exitQueueEpoch = exitEpoch;
          exitQueueChurn = 1;
        } else if (exitEpoch === exitQueueEpoch) {
          exitQueueChurn += 1;
        }
      }
    }

    // Spec: `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero
    // 1 = 1 unit of EFFECTIVE_BALANCE_INCREMENT
    if (totalActiveBalanceIncrements < 1) {
      totalActiveBalanceIncrements = 1;
    } else if (totalActiveBalanceIncrements >= Number.MAX_SAFE_INTEGER) {
      throw Error("totalActiveBalanceIncrements >= Number.MAX_SAFE_INTEGER. MAX_EFFECTIVE_BALANCE is too low.");
    }

    const nextActiveIndices = new Uint32Array(nextActiveIndicesAsNumberArray);
    let previousShuffling: EpochShuffling;
    let currentShuffling: EpochShuffling;
    let nextShuffling: EpochShuffling;

    if (!shufflingCache) {
      // Only for testing. shufflingCache should always be available in prod
      previousShuffling = computeEpochShuffling(
        state,
        new Uint32Array(previousActiveIndicesAsNumberArray),
        previousEpoch
      );

      currentShuffling = isGenesis
        ? previousShuffling
        : computeEpochShuffling(state, new Uint32Array(currentActiveIndicesAsNumberArray), currentEpoch);

      nextShuffling = computeEpochShuffling(state, nextActiveIndices, nextEpoch);
    } else {
      currentShuffling = cachedCurrentShuffling
        ? cachedCurrentShuffling
        : shufflingCache.getSync(currentEpoch, currentDecisionRoot, {
            state,
            activeIndices: new Uint32Array(currentActiveIndicesAsNumberArray),
          });

      previousShuffling = cachedPreviousShuffling
        ? cachedPreviousShuffling
        : isGenesis
          ? currentShuffling
          : shufflingCache.getSync(previousEpoch, previousDecisionRoot, {
              state,
              activeIndices: new Uint32Array(previousActiveIndicesAsNumberArray),
            });

      nextShuffling = cachedNextShuffling
        ? cachedNextShuffling
        : shufflingCache.getSync(nextEpoch, nextDecisionRoot, {
            state,
            activeIndices: nextActiveIndices,
          });
    }

    const currentProposerSeed = getSeed(state, currentEpoch, DOMAIN_BEACON_PROPOSER);

    // Allow to create CachedBeaconState for empty states, or no active validators
    const proposers =
      currentShuffling.activeIndices.length > 0
        ? computeProposers(
            config.getForkSeqAtEpoch(currentEpoch),
            currentProposerSeed,
            currentShuffling,
            effectiveBalanceIncrements
          )
        : [];

    const proposersNextEpoch: ProposersDeferred = {
      computed: false,
      seed: getSeed(state, nextEpoch, DOMAIN_BEACON_PROPOSER),
    };

    // Only after altair, compute the indices of the current sync committee
    const afterAltairFork = currentEpoch >= config.ALTAIR_FORK_EPOCH;

    // Values syncParticipantReward, syncProposerReward, baseRewardPerIncrement are only used after altair.
    // However, since they are very cheap to compute they are computed always to simplify upgradeState function.
    const syncParticipantReward = computeSyncParticipantReward(totalActiveBalanceIncrements);
    const syncProposerReward = Math.floor(syncParticipantReward * PROPOSER_WEIGHT_FACTOR);
    const baseRewardPerIncrement = computeBaseRewardPerIncrement(totalActiveBalanceIncrements);

    let currentSyncCommitteeIndexed: SyncCommitteeCache;
    let nextSyncCommitteeIndexed: SyncCommitteeCache;
    // Allow to skip populating sync committee for initializeBeaconStateFromEth1()
    if (afterAltairFork && !opts?.skipSyncCommitteeCache) {
      const altairState = state as BeaconStateAltair;
      currentSyncCommitteeIndexed = computeSyncCommitteeCache(altairState.currentSyncCommittee, pubkey2index);
      nextSyncCommitteeIndexed = computeSyncCommitteeCache(altairState.nextSyncCommittee, pubkey2index);
    } else {
      currentSyncCommitteeIndexed = new SyncCommitteeCacheEmpty();
      nextSyncCommitteeIndexed = new SyncCommitteeCacheEmpty();
    }

    // Precompute churnLimit for efficient initiateValidatorExit() during block proposing MUST be recompute everytime the
    // active validator indices set changes in size. Validators change active status only when:
    // - validator.activation_epoch is set. Only changes in process_registry_updates() if validator can be activated. If
    //   the value changes it will be set to `epoch + 1 + MAX_SEED_LOOKAHEAD`.
    // - validator.exit_epoch is set. Only changes in initiate_validator_exit() if validator exits. If the value changes,
    //   it will be set to at least `epoch + 1 + MAX_SEED_LOOKAHEAD`.
    // ```
    // is_active_validator = validator.activation_epoch <= epoch < validator.exit_epoch
    // ```
    // So the returned value of is_active_validator(epoch) is guaranteed to not change during `MAX_SEED_LOOKAHEAD` epochs.
    //
    // activeIndices size is dependent on the state epoch. The epoch is advanced after running the epoch transition, and
    // the first block of the epoch process_block() call. So churnLimit must be computed at the end of the before epoch
    // transition and the result is valid until the end of the next epoch transition
    const churnLimit = getChurnLimit(config, currentShuffling.activeIndices.length);
    const activationChurnLimit = getActivationChurnLimit(
      config,
      config.getForkSeq(state.slot),
      currentShuffling.activeIndices.length
    );
    if (exitQueueChurn >= churnLimit) {
      exitQueueEpoch += 1;
      exitQueueChurn = 0;
    }

    // TODO: describe issue. Compute progressive target balances
    // Compute balances from zero, note this state could be mid-epoch so target balances != 0
    let previousTargetUnslashedBalanceIncrements = 0;
    let currentTargetUnslashedBalanceIncrements = 0;

    if (config.getForkSeq(state.slot) >= ForkSeq.altair) {
      const {previousEpochParticipation, currentEpochParticipation} = state as BeaconStateAltair;
      previousTargetUnslashedBalanceIncrements = sumTargetUnslashedBalanceIncrements(
        previousEpochParticipation.getAll(),
        previousEpoch,
        validators
      );
      currentTargetUnslashedBalanceIncrements = sumTargetUnslashedBalanceIncrements(
        currentEpochParticipation.getAll(),
        currentEpoch,
        validators
      );
    }

    return new EpochCache({
      config,
      pubkey2index,
      index2pubkey,
      // `createFromFinalizedState()` creates cache with empty unfinalizedPubkey2index. Be cautious to only pass in finalized state
      unfinalizedPubkey2index: newUnfinalizedPubkeyIndexMap(),
      shufflingCache,
      proposers,
      // On first epoch, set to null to prevent unnecessary work since this is only used for metrics
      proposersPrevEpoch: null,
      proposersNextEpoch,
      previousDecisionRoot,
      currentDecisionRoot,
      nextDecisionRoot,
      previousShuffling,
      currentShuffling,
      nextShuffling,
      nextActiveIndices,
      effectiveBalanceIncrements,
      totalSlashingsByIncrement,
      syncParticipantReward,
      syncProposerReward,
      baseRewardPerIncrement,
      totalActiveBalanceIncrements,
      churnLimit,
      activationChurnLimit,
      exitQueueEpoch,
      exitQueueChurn,
      previousTargetUnslashedBalanceIncrements,
      currentTargetUnslashedBalanceIncrements,
      currentSyncCommitteeIndexed,
      nextSyncCommitteeIndexed,
      epoch: currentEpoch,
      syncPeriod: computeSyncPeriodAtEpoch(currentEpoch),
      historialValidatorLengths: immutable.List(),
    });
  }

  /**
   * Copies a given EpochCache while avoiding copying its immutable parts.
   */
  clone(): EpochCache {
    // warning: pubkey cache is not copied, it is shared, as eth1 is not expected to reorder validators.
    // Shallow copy all data from current epoch context to the next
    // All data is completely replaced, or only-appended
    return new EpochCache({
      config: this.config,
      // Common append-only structures shared with all states, no need to clone
      pubkey2index: this.pubkey2index,
      index2pubkey: this.index2pubkey,
      // No need to clone this reference. On each mutation the `unfinalizedPubkey2index` reference is replaced, @see `addPubkey`
      unfinalizedPubkey2index: this.unfinalizedPubkey2index,
      shufflingCache: this.shufflingCache,
      // Immutable data
      proposers: this.proposers,
      proposersPrevEpoch: this.proposersPrevEpoch,
      proposersNextEpoch: this.proposersNextEpoch,
      previousDecisionRoot: this.previousDecisionRoot,
      currentDecisionRoot: this.currentDecisionRoot,
      nextDecisionRoot: this.nextDecisionRoot,
      previousShuffling: this.previousShuffling,
      currentShuffling: this.currentShuffling,
      nextShuffling: this.nextShuffling,
      nextActiveIndices: this.nextActiveIndices,
      // Uint8Array, requires cloning, but it is cloned only when necessary before an epoch transition
      // See EpochCache.beforeEpochTransition()
      effectiveBalanceIncrements: this.effectiveBalanceIncrements,
      totalSlashingsByIncrement: this.totalSlashingsByIncrement,
      // Basic types (numbers) cloned implicitly
      syncParticipantReward: this.syncParticipantReward,
      syncProposerReward: this.syncProposerReward,
      baseRewardPerIncrement: this.baseRewardPerIncrement,
      totalActiveBalanceIncrements: this.totalActiveBalanceIncrements,
      churnLimit: this.churnLimit,
      activationChurnLimit: this.activationChurnLimit,
      exitQueueEpoch: this.exitQueueEpoch,
      exitQueueChurn: this.exitQueueChurn,
      previousTargetUnslashedBalanceIncrements: this.previousTargetUnslashedBalanceIncrements,
      currentTargetUnslashedBalanceIncrements: this.currentTargetUnslashedBalanceIncrements,
      currentSyncCommitteeIndexed: this.currentSyncCommitteeIndexed,
      nextSyncCommitteeIndexed: this.nextSyncCommitteeIndexed,
      epoch: this.epoch,
      syncPeriod: this.syncPeriod,
      historialValidatorLengths: this.historicalValidatorLengths,
    });
  }

  /**
   * Called to re-use information, such as the shuffling of the next epoch, after transitioning into a
   * new epoch. Also handles pre-computation of values that may change during the upcoming epoch and
   * that get used in the following epoch transition.  Often those pre-computations are not used by the
   * chain but are courtesy values that are served via the API for epoch look ahead of duties.
   *
   * Steps for afterProcessEpoch
   * 1) update previous/current/next values of cached items
   */
  afterProcessEpoch(
    state: CachedBeaconStateAllForks,
    epochTransitionCache: {
      nextShufflingDecisionRoot: RootHex;
      nextShufflingActiveIndices: Uint32Array;
      nextEpochTotalActiveBalanceByIncrement: number;
    }
  ): void {
    // Because the slot was incremented before entering this function the "next epoch" is actually the "current epoch"
    // in this context but that is not actually true because the state transition happens in the last 4 seconds of the
    // epoch. For the context of this function "upcoming epoch" is used to denote the epoch that will begin after this
    // function returns.  The epoch that is "next" once the state transition is complete is referred to as the
    // epochAfterUpcoming for the same reason to help minimize confusion.
    const upcomingEpoch = this.nextEpoch;
    const epochAfterUpcoming = upcomingEpoch + 1;

    // move current to previous
    this.previousShuffling = this.currentShuffling;
    this.previousDecisionRoot = this.currentDecisionRoot;
    this.proposersPrevEpoch = this.proposers;

    // move next to current or calculate upcoming
    this.currentDecisionRoot = this.nextDecisionRoot;
    if (this.nextShuffling) {
      // was already pulled from the ShufflingCache to the EpochCache (should be in most cases)
      this.currentShuffling = this.nextShuffling;
    } else {
      this.shufflingCache?.metrics?.shufflingCache.nextShufflingNotOnEpochCache.inc();
      this.currentShuffling =
        this.shufflingCache?.getSync(upcomingEpoch, this.currentDecisionRoot, {
          state,
          // have to use the "nextActiveIndices" that were saved in the last transition here to calculate
          // the upcoming shuffling if it is not already built (similar condition to the below computation)
          activeIndices: this.nextActiveIndices,
        }) ??
        // allow for this case during testing where the ShufflingCache is not present, may affect perf testing
        // so should be taken into account when structuring tests.  Should not affect unit or other tests though
        computeEpochShuffling(state, this.nextActiveIndices, upcomingEpoch);
    }
    const upcomingProposerSeed = getSeed(state, upcomingEpoch, DOMAIN_BEACON_PROPOSER);
    // next epoch was moved to current epoch so use current here
    this.proposers = computeProposers(
      this.config.getForkSeqAtEpoch(upcomingEpoch),
      upcomingProposerSeed,
      this.currentShuffling,
      this.effectiveBalanceIncrements
    );

    // handle next values
    this.nextDecisionRoot = epochTransitionCache.nextShufflingDecisionRoot;
    this.nextActiveIndices = epochTransitionCache.nextShufflingActiveIndices;
    if (this.shufflingCache) {
      this.nextShuffling = null;
      // This promise will resolve immediately after the synchronous code of the state-transition runs. Until
      // the build is done on a worker thread it will be calculated immediately after the epoch transition
      // completes.  Once the work is done concurrently it should be ready by time this get runs so the promise
      // will resolve directly on the next spin of the event loop because the epoch transition and shuffling take
      // about the same time to calculate so theoretically its ready now.  Do not await here though in case it
      // is not ready yet as the transition must not be asynchronous.
      this.shufflingCache
        .get(epochAfterUpcoming, this.nextDecisionRoot)
        .then((shuffling) => {
          if (!shuffling) {
            throw new Error("EpochShuffling not returned from get in afterProcessEpoch");
          }
          this.nextShuffling = shuffling;
        })
        .catch((err) => {
          this.shufflingCache?.logger?.error(
            "EPOCH_CONTEXT_SHUFFLING_BUILD_ERROR",
            {epoch: epochAfterUpcoming, decisionRoot: epochTransitionCache.nextShufflingDecisionRoot},
            err
          );
        });
    } else {
      // Only for testing. shufflingCache should always be available in prod
      this.nextShuffling = computeEpochShuffling(state, this.nextActiveIndices, epochAfterUpcoming);
    }

    // Only pre-compute the seed since it's very cheap. Do the expensive computeProposers() call only on demand.
    this.proposersNextEpoch = {computed: false, seed: getSeed(state, epochAfterUpcoming, DOMAIN_BEACON_PROPOSER)};

    // TODO: DEDUPLICATE from createEpochCache
    //
    // Precompute churnLimit for efficient initiateValidatorExit() during block proposing MUST be recompute every time the
    // active validator indices set changes in size. Validators change active status only when:
    // - validator.activation_epoch is set. Only changes in process_registry_updates() if validator can be activated. If
    //   the value changes it will be set to `epoch + 1 + MAX_SEED_LOOKAHEAD`.
    // - validator.exit_epoch is set. Only changes in initiate_validator_exit() if validator exits. If the value changes,
    //   it will be set to at least `epoch + 1 + MAX_SEED_LOOKAHEAD`.
    // ```
    // is_active_validator = validator.activation_epoch <= epoch < validator.exit_epoch
    // ```
    // So the returned value of is_active_validator(epoch) is guaranteed to not change during `MAX_SEED_LOOKAHEAD` epochs.
    //
    // activeIndices size is dependent on the state epoch. The epoch is advanced after running the epoch transition, and
    // the first block of the epoch process_block() call. So churnLimit must be computed at the end of the before epoch
    // transition and the result is valid until the end of the next epoch transition
    this.churnLimit = getChurnLimit(this.config, this.currentShuffling.activeIndices.length);
    this.activationChurnLimit = getActivationChurnLimit(
      this.config,
      this.config.getForkSeq(state.slot),
      this.currentShuffling.activeIndices.length
    );

    // Maybe advance exitQueueEpoch at the end of the epoch if there haven't been any exists for a while
    const exitQueueEpoch = computeActivationExitEpoch(upcomingEpoch);
    if (exitQueueEpoch > this.exitQueueEpoch) {
      this.exitQueueEpoch = exitQueueEpoch;
      this.exitQueueChurn = 0;
    }

    this.totalActiveBalanceIncrements = epochTransitionCache.nextEpochTotalActiveBalanceByIncrement;
    if (upcomingEpoch >= this.config.ALTAIR_FORK_EPOCH) {
      this.syncParticipantReward = computeSyncParticipantReward(this.totalActiveBalanceIncrements);
      this.syncProposerReward = Math.floor(this.syncParticipantReward * PROPOSER_WEIGHT_FACTOR);
      this.baseRewardPerIncrement = computeBaseRewardPerIncrement(this.totalActiveBalanceIncrements);
    }

    this.previousTargetUnslashedBalanceIncrements = this.currentTargetUnslashedBalanceIncrements;
    this.currentTargetUnslashedBalanceIncrements = 0;

    // Advance time units
    // state.slot is advanced right before calling this function
    // ```
    // postState.slot++;
    // afterProcessEpoch(postState, epochTransitionCache);
    // ```
    this.epoch = computeEpochAtSlot(state.slot);
    this.syncPeriod = computeSyncPeriodAtEpoch(this.epoch);
    // ELECTRA Only: Add current cpState.validators.length
    // Only keep validatorLength for epochs after finalized cpState.epoch
    // eg. [100(epoch 1), 102(epoch 2)].push(104(epoch 3)), this.epoch = 3, finalized cp epoch = 1
    // We keep the last (3 - 1) items = [102, 104]
    if (upcomingEpoch >= this.config.ELECTRA_FORK_EPOCH) {
      this.historicalValidatorLengths = this.historicalValidatorLengths.push(state.validators.length);

      // If number of validatorLengths we want to keep exceeds the current list size, it implies
      // finalized checkpoint hasn't advanced, and no need to slice
      const hasFinalizedCpAdvanced =
        this.epoch - state.finalizedCheckpoint.epoch < this.historicalValidatorLengths.size;

      if (hasFinalizedCpAdvanced) {
        // We use finalized cp epoch - this.epoch which is a negative number to keep the last n entries and discard the rest
        this.historicalValidatorLengths = this.historicalValidatorLengths.slice(
          state.finalizedCheckpoint.epoch - this.epoch
        );
      }
    }
  }

  beforeEpochTransition(): void {
    // Clone (copy) before being mutated in processEffectiveBalanceUpdates
    // NOTE: Force to use Uint16Array.slice (copy) instead of Buffer.call (not copy)
    this.effectiveBalanceIncrements = Uint16Array.prototype.slice.call(this.effectiveBalanceIncrements, 0);
  }

  /**
   * Return the beacon committee at slot for index.
   */
  getBeaconCommittee(slot: Slot, index: CommitteeIndex): Uint32Array {
    return this.getBeaconCommittees(slot, [index]);
  }

  /**
   * Return a single Uint32Array representing concatted committees of indices
   */
  getBeaconCommittees(slot: Slot, indices: CommitteeIndex[]): Uint32Array {
    if (indices.length === 0) {
      throw new Error("Attempt to get committees without providing CommitteeIndex");
    }

    const slotCommittees = this.getShufflingAtSlot(slot).committees[slot % SLOTS_PER_EPOCH];
    const committees = [];

    for (const index of indices) {
      if (index >= slotCommittees.length) {
        throw new EpochCacheError({
          code: EpochCacheErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
          index,
          maxIndex: slotCommittees.length,
        });
      }
      committees.push(slotCommittees[index]);
    }

    // Early return if only one index
    if (committees.length === 1) {
      return committees[0];
    }

    // Create a new Uint32Array to flatten `committees`
    const totalLength = committees.reduce((acc, curr) => acc + curr.length, 0);
    const result = new Uint32Array(totalLength);

    let offset = 0;
    for (const committee of committees) {
      result.set(committee, offset);
      offset += committee.length;
    }

    return result;
  }

  getCommitteeCountPerSlot(epoch: Epoch): number {
    return this.getShufflingAtEpoch(epoch).committeesPerSlot;
  }

  /**
   * Compute the correct subnet for a slot/committee index
   */
  computeSubnetForSlot(slot: number, committeeIndex: number): number {
    const slotsSinceEpochStart = slot % SLOTS_PER_EPOCH;
    const committeesPerSlot = this.getCommitteeCountPerSlot(computeEpochAtSlot(slot));
    const committeesSinceEpochStart = committeesPerSlot * slotsSinceEpochStart;
    return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    const epoch = computeEpochAtSlot(slot);
    if (epoch !== this.currentShuffling.epoch) {
      throw new EpochCacheError({
        code: EpochCacheErrorCode.PROPOSER_EPOCH_MISMATCH,
        currentEpoch: this.currentShuffling.epoch,
        requestedEpoch: epoch,
      });
    }
    return this.proposers[slot % SLOTS_PER_EPOCH];
  }

  getBeaconProposers(): ValidatorIndex[] {
    return this.proposers;
  }

  getBeaconProposersPrevEpoch(): ValidatorIndex[] | null {
    return this.proposersPrevEpoch;
  }

  /**
   * We allow requesting proposal duties 1 epoch in the future as in normal network conditions it's possible to predict
   * the correct shuffling with high probability. While knowing the proposers in advance is not useful for consensus,
   * users want to know it to plan manteinance and avoid missing block proposals.
   *
   * **How to predict future proposers**
   *
   * Proposer duties for epoch N are guaranteed to be known at epoch N. Proposer duties depend exclusively on:
   * 1. seed (from randao_mix): known 2 epochs ahead
   * 2. active validator set: known 4 epochs ahead
   * 3. effective balance: not known ahead
   *
   * ```python
   * def get_beacon_proposer_index(state: BeaconState) -> ValidatorIndex:
   *   epoch = get_current_epoch(state)
   *   seed = hash(get_seed(state, epoch, DOMAIN_BEACON_PROPOSER) + uint_to_bytes(state.slot))
   *   indices = get_active_validator_indices(state, epoch)
   *   return compute_proposer_index(state, indices, seed)
   * ```
   *
   * **1**: If `MIN_SEED_LOOKAHEAD = 1` the randao_mix used for the seed is from 2 epochs ago. So at epoch N, the seed
   * is known and unchangable for duties at epoch N+1 and N+2 for proposer duties.
   *
   * ```python
   * def get_seed(state: BeaconState, epoch: Epoch, domain_type: DomainType) -> Bytes32:
   *   mix = get_randao_mix(state, Epoch(epoch - MIN_SEED_LOOKAHEAD - 1))
   *   return hash(domain_type + uint_to_bytes(epoch) + mix)
   * ```
   *
   * **2**: The active validator set can be predicted `MAX_SEED_LOOKAHEAD` in advance due to how activations are
   * processed. We already compute the active validator set for the next epoch to optimize epoch processing, so it's
   * reused here.
   *
   * **3**: Effective balance is not known ahead of time, but it rarely changes. Even if it changes, only a few
   * balances are sampled to adjust the probability of the next selection (32 per epoch on average). So to invalidate
   * the prediction the effective of one of those 32 samples should change and change the random_byte inequality.
   */
  getBeaconProposersNextEpoch(): ValidatorIndex[] {
    if (!this.proposersNextEpoch.computed) {
      const indexes = computeProposers(
        this.config.getForkSeqAtEpoch(this.nextEpoch),
        this.proposersNextEpoch.seed,
        this.getShufflingAtEpoch(this.nextEpoch),
        this.effectiveBalanceIncrements
      );
      this.proposersNextEpoch = {computed: true, indexes};
    }

    return this.proposersNextEpoch.indexes;
  }

  /**
   * Return the indexed attestation corresponding to ``attestation``.
   */
  getIndexedAttestation(fork: ForkSeq, attestation: Attestation): IndexedAttestation {
    const {data} = attestation;
    const attestingIndices = this.getAttestingIndices(fork, attestation);

    // sort in-place
    attestingIndices.sort((a, b) => a - b);
    return {
      attestingIndices: attestingIndices,
      data: data,
      signature: attestation.signature,
    };
  }

  /**
   * Return indices of validators who attestested in `attestation`
   */
  getAttestingIndices(fork: ForkSeq, attestation: Attestation): number[] {
    if (fork < ForkSeq.electra) {
      const {aggregationBits, data} = attestation;
      const validatorIndices = this.getBeaconCommittee(data.slot, data.index);

      return aggregationBits.intersectValues(validatorIndices);
    }
    const {aggregationBits, committeeBits, data} = attestation as electra.Attestation;

    // There is a naming conflict on the term `committeeIndices`
    // In Lodestar it usually means a list of validator indices of participants in a committee
    // In the spec it means a list of committee indices according to committeeBits
    // This `committeeIndices` refers to the latter
    // TODO Electra: resolve the naming conflicts
    const committeeIndices = committeeBits.getTrueBitIndexes();

    const validatorIndices = this.getBeaconCommittees(data.slot, committeeIndices);

    return aggregationBits.intersectValues(validatorIndices);
  }

  getCommitteeAssignments(
    epoch: Epoch,
    requestedValidatorIndices: ValidatorIndex[]
  ): Map<ValidatorIndex, AttesterDuty> {
    const shuffling = this.getShufflingAtEpoch(epoch);
    return calculateCommitteeAssignments(shuffling, requestedValidatorIndices);
  }

  /**
   * Return the committee assignment in the ``epoch`` for ``validator_index``.
   * ``assignment`` returned is a tuple of the following form:
   * ``assignment[0]`` is the list of validators in the committee
   * ``assignment[1]`` is the index to which the committee is assigned
   * ``assignment[2]`` is the slot at which the committee is assigned
   * Return null if no assignment..
   */
  getCommitteeAssignment(epoch: Epoch, validatorIndex: ValidatorIndex): phase0.CommitteeAssignment | null {
    if (epoch > this.currentShuffling.epoch + 1) {
      throw Error(
        `Requesting committee assignment for more than 1 epoch ahead: ${epoch} > ${this.currentShuffling.epoch} + 1`
      );
    }

    const epochStartSlot = computeStartSlotAtEpoch(epoch);
    const committeeCountPerSlot = this.getCommitteeCountPerSlot(epoch);
    for (let slot = epochStartSlot; slot < epochStartSlot + SLOTS_PER_EPOCH; slot++) {
      for (let i = 0; i < committeeCountPerSlot; i++) {
        const committee = this.getBeaconCommittee(slot, i);
        if (committee.includes(validatorIndex)) {
          return {
            validators: Array.from(committee),
            committeeIndex: i,
            slot,
          };
        }
      }
    }
    return null;
  }

  isAggregator(slot: Slot, index: CommitteeIndex, slotSignature: BLSSignature): boolean {
    const committee = this.getBeaconCommittee(slot, index);
    return isAggregatorFromCommitteeLength(committee.length, slotSignature);
  }

  /**
   * Return finalized pubkey given the validator index.
   * Only finalized pubkey as we do not store unfinalized pubkey because no where in the spec has a
   * need to make such enquiry
   */
  getPubkey(index: ValidatorIndex): PublicKey | undefined {
    return this.index2pubkey[index];
  }

  getValidatorIndex(pubkey: Uint8Array): ValidatorIndex | null {
    if (this.isPostElectra()) {
      return this.pubkey2index.get(pubkey) ?? this.unfinalizedPubkey2index.get(toMemoryEfficientHexStr(pubkey)) ?? null;
    }
    return this.pubkey2index.get(pubkey);
  }

  /**
   *
   * Add unfinalized pubkeys
   *
   */
  addPubkey(index: ValidatorIndex, pubkey: Uint8Array): void {
    if (this.isPostElectra()) {
      this.addUnFinalizedPubkey(index, pubkey);
    } else {
      // deposit mechanism pre ELECTRA follows a safe distance with assumption
      // that they are already canonical
      this.addFinalizedPubkey(index, pubkey);
    }
  }

  addUnFinalizedPubkey(index: ValidatorIndex, pubkey: PubkeyHex | Uint8Array, metrics?: EpochCacheMetrics): void {
    this.unfinalizedPubkey2index = this.unfinalizedPubkey2index.set(toMemoryEfficientHexStr(pubkey), index);
    metrics?.newUnFinalizedPubkey.inc();
  }

  addFinalizedPubkeys(pubkeyMap: UnfinalizedPubkeyIndexMap, metrics?: EpochCacheMetrics): void {
    pubkeyMap.forEach((index, pubkey) => this.addFinalizedPubkey(index, pubkey, metrics));
  }

  /**
   * Add finalized validator index and pubkey into finalized cache.
   * Since addFinalizedPubkey() primarily takes pubkeys from unfinalized cache, it can take pubkey hex string directly
   */
  addFinalizedPubkey(index: ValidatorIndex, pubkeyOrHex: PubkeyHex | Uint8Array, metrics?: EpochCacheMetrics): void {
    const pubkey = typeof pubkeyOrHex === "string" ? fromHex(pubkeyOrHex) : pubkeyOrHex;
    const existingIndex = this.pubkey2index.get(pubkey);

    if (existingIndex !== null) {
      if (existingIndex === index) {
        // Repeated insert.
        metrics?.finalizedPubkeyDuplicateInsert.inc();
        return;
      }
      // attempt to insert the same pubkey with different index, should never happen.
      throw Error(
        `inserted existing pubkey into finalizedPubkey2index cache with a different index, index=${index} priorIndex=${existingIndex}`
      );
    }

    this.pubkey2index.set(pubkey, index);
    const pubkeyBytes = pubkey instanceof Uint8Array ? pubkey : fromHex(pubkey);
    this.index2pubkey[index] = PublicKey.fromBytes(pubkeyBytes); // Optimize for aggregation
  }

  /**
   * Delete pubkeys from unfinalized cache
   */
  deleteUnfinalizedPubkeys(pubkeys: Iterable<PubkeyHex>): void {
    this.unfinalizedPubkey2index = this.unfinalizedPubkey2index.deleteAll(pubkeys);
  }

  getShufflingAtSlot(slot: Slot): EpochShuffling {
    const epoch = computeEpochAtSlot(slot);
    return this.getShufflingAtEpoch(epoch);
  }

  getShufflingAtSlotOrNull(slot: Slot): EpochShuffling | null {
    const epoch = computeEpochAtSlot(slot);
    return this.getShufflingAtEpochOrNull(epoch);
  }

  getShufflingAtEpoch(epoch: Epoch): EpochShuffling {
    const shuffling = this.getShufflingAtEpochOrNull(epoch);
    if (shuffling === null) {
      if (epoch === this.nextEpoch) {
        throw new EpochCacheError({
          code: EpochCacheErrorCode.NEXT_SHUFFLING_NOT_AVAILABLE,
          epoch: epoch,
          decisionRoot: this.getShufflingDecisionRoot(this.nextEpoch),
        });
      }
      throw new EpochCacheError({
        code: EpochCacheErrorCode.COMMITTEE_EPOCH_OUT_OF_RANGE,
        currentEpoch: this.currentShuffling.epoch,
        requestedEpoch: epoch,
      });
    }

    return shuffling;
  }

  getShufflingDecisionRoot(epoch: Epoch): RootHex {
    switch (epoch) {
      case this.epoch - 1:
        return this.previousDecisionRoot;
      case this.epoch:
        return this.currentDecisionRoot;
      case this.nextEpoch:
        return this.nextDecisionRoot;
      default:
        throw new EpochCacheError({
          code: EpochCacheErrorCode.DECISION_ROOT_EPOCH_OUT_OF_RANGE,
          currentEpoch: this.epoch,
          requestedEpoch: epoch,
        });
    }
  }

  getShufflingAtEpochOrNull(epoch: Epoch): EpochShuffling | null {
    switch (epoch) {
      case this.epoch - 1:
        return this.previousShuffling;
      case this.epoch:
        return this.currentShuffling;
      case this.nextEpoch:
        if (!this.nextShuffling) {
          this.nextShuffling =
            this.shufflingCache?.getSync(this.nextEpoch, this.getShufflingDecisionRoot(this.nextEpoch)) ?? null;
        }
        return this.nextShuffling;
      default:
        return null;
    }
  }

  /**
   * Note: The range of slots a validator has to perform duties is off by one.
   * The previous slot wording means that if your validator is in a sync committee for a period that runs from slot
   * 100 to 200,then you would actually produce signatures in slot 99 - 199.
   */
  getIndexedSyncCommittee(slot: Slot): SyncCommitteeCache {
    // See note above for the +1 offset
    return this.getIndexedSyncCommitteeAtEpoch(computeEpochAtSlot(slot + 1));
  }

  /**
   * **DO NOT USE FOR GOSSIP VALIDATION**: Sync committee duties are offset by one slot. @see {@link EpochCache.getIndexedSyncCommittee}
   *
   * Get indexed sync committee at epoch without offsets
   */
  getIndexedSyncCommitteeAtEpoch(epoch: Epoch): SyncCommitteeCache {
    switch (computeSyncPeriodAtEpoch(epoch)) {
      case this.syncPeriod:
        return this.currentSyncCommitteeIndexed;
      case this.syncPeriod + 1:
        return this.nextSyncCommitteeIndexed;
      default:
        throw new EpochCacheError({code: EpochCacheErrorCode.NO_SYNC_COMMITTEE, epoch});
    }
  }

  /** On processSyncCommitteeUpdates rotate next to current and set nextSyncCommitteeIndexed */
  rotateSyncCommitteeIndexed(nextSyncCommitteeIndices: number[]): void {
    this.currentSyncCommitteeIndexed = this.nextSyncCommitteeIndexed;
    this.nextSyncCommitteeIndexed = getSyncCommitteeCache(nextSyncCommitteeIndices);
  }

  /** On phase0 -> altair fork, set both current and nextSyncCommitteeIndexed */
  setSyncCommitteesIndexed(nextSyncCommitteeIndices: number[]): void {
    this.nextSyncCommitteeIndexed = getSyncCommitteeCache(nextSyncCommitteeIndices);
    this.currentSyncCommitteeIndexed = this.nextSyncCommitteeIndexed;
  }

  effectiveBalanceIncrementsSet(index: number, effectiveBalance: number): void {
    if (this.isPostElectra()) {
      // TODO: electra
      // getting length and setting getEffectiveBalanceIncrementsByteLen is not fork safe
      // so each time we add an index, we should new the Uint8Array to keep it forksafe
      // one simple optimization could be to increment the length once per block rather
      // on each add/set
      //
      // there could still be some unused length remaining from the prev ELECTRA padding
      const newLength =
        index >= this.effectiveBalanceIncrements.length ? index + 1 : this.effectiveBalanceIncrements.length;
      const effectiveBalanceIncrements = this.effectiveBalanceIncrements;
      this.effectiveBalanceIncrements = new Uint16Array(newLength);
      this.effectiveBalanceIncrements.set(effectiveBalanceIncrements, 0);
    } else {
      if (index >= this.effectiveBalanceIncrements.length) {
        // Clone and extend effectiveBalanceIncrements
        const effectiveBalanceIncrements = this.effectiveBalanceIncrements;
        this.effectiveBalanceIncrements = new Uint16Array(getEffectiveBalanceIncrementsByteLen(index + 1));
        this.effectiveBalanceIncrements.set(effectiveBalanceIncrements, 0);
      }
    }

    this.effectiveBalanceIncrements[index] = Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
  }

  isPostElectra(): boolean {
    return this.epoch >= this.config.ELECTRA_FORK_EPOCH;
  }

  getValidatorCountAtEpoch(targetEpoch: Epoch): number | undefined {
    const currentEpoch = this.epoch;

    if (targetEpoch === currentEpoch) {
      return this.historicalValidatorLengths.get(-1);
    }

    // Attempt to get validator count from future epoch
    if (targetEpoch > currentEpoch) {
      return undefined;
    }

    // targetEpoch is so far back that historicalValidatorLengths doesnt contain such info
    if (targetEpoch < currentEpoch - this.historicalValidatorLengths.size + 1) {
      return undefined;
    }
    return this.historicalValidatorLengths.get(targetEpoch - currentEpoch - 1);
  }
}

function getEffectiveBalanceIncrementsByteLen(validatorCount: number): number {
  // TODO: Research what's the best number to minimize both memory cost and copy costs
  return 1024 * Math.ceil(validatorCount / 1024);
}

export enum EpochCacheErrorCode {
  COMMITTEE_INDEX_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_COMMITTEE_INDEX_OUT_OF_RANGE",
  COMMITTEE_EPOCH_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_COMMITTEE_EPOCH_OUT_OF_RANGE",
  DECISION_ROOT_EPOCH_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_DECISION_ROOT_EPOCH_OUT_OF_RANGE",
  NEXT_SHUFFLING_NOT_AVAILABLE = "EPOCH_CONTEXT_ERROR_NEXT_SHUFFLING_NOT_AVAILABLE",
  NO_SYNC_COMMITTEE = "EPOCH_CONTEXT_ERROR_NO_SYNC_COMMITTEE",
  PROPOSER_EPOCH_MISMATCH = "EPOCH_CONTEXT_ERROR_PROPOSER_EPOCH_MISMATCH",
}

type EpochCacheErrorType =
  | {
      code: EpochCacheErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE;
      index: number;
      maxIndex: number;
    }
  | {
      code: EpochCacheErrorCode.COMMITTEE_EPOCH_OUT_OF_RANGE;
      requestedEpoch: Epoch;
      currentEpoch: Epoch;
    }
  | {
      code: EpochCacheErrorCode.DECISION_ROOT_EPOCH_OUT_OF_RANGE;
      requestedEpoch: Epoch;
      currentEpoch: Epoch;
    }
  | {
      code: EpochCacheErrorCode.NEXT_SHUFFLING_NOT_AVAILABLE;
      epoch: Epoch;
      decisionRoot: RootHex;
    }
  | {
      code: EpochCacheErrorCode.NO_SYNC_COMMITTEE;
      epoch: Epoch;
    }
  | {
      code: EpochCacheErrorCode.PROPOSER_EPOCH_MISMATCH;
      requestedEpoch: Epoch;
      currentEpoch: Epoch;
    };

export class EpochCacheError extends LodestarError<EpochCacheErrorType> {}

export function createEmptyEpochCacheImmutableData(
  chainConfig: ChainConfig,
  state: Pick<BeaconStateAllForks, "genesisValidatorsRoot">
): EpochCacheImmutableData {
  return {
    config: createBeaconConfig(chainConfig, state.genesisValidatorsRoot),
    // This is a test state, there's no need to have a global shared cache of keys
    pubkey2index: new PubkeyIndexMap(),
    index2pubkey: [],
  };
}
