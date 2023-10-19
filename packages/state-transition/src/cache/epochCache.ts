import {CoordType} from "@chainsafe/bls/types";
import bls from "@chainsafe/bls";
import {BLSSignature, CommitteeIndex, Epoch, Slot, ValidatorIndex, phase0, SyncPeriod} from "@lodestar/types";
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
import {LodestarError} from "@lodestar/utils";
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
import {computeEpochShuffling, EpochShuffling} from "../util/epochShuffling.js";
import {computeBaseRewardPerIncrement, computeSyncParticipantReward} from "../util/syncCommittee.js";
import {sumTargetUnslashedBalanceIncrements} from "../util/targetUnslashedBalance.js";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsWithLen} from "./effectiveBalanceIncrements.js";
import {Index2PubkeyCache, PubkeyIndexMap, syncPubkeys} from "./pubkeyCache.js";
import {BeaconStateAllForks, BeaconStateAltair} from "./types.js";
import {
  computeSyncCommitteeCache,
  getSyncCommitteeCache,
  SyncCommitteeCache,
  SyncCommitteeCacheEmpty,
} from "./syncCommitteeCache.js";

/** `= PROPOSER_WEIGHT / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)` */
export const PROPOSER_WEIGHT_FACTOR = PROPOSER_WEIGHT / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);

export type EpochCacheImmutableData = {
  config: BeaconConfig;
  pubkey2index: PubkeyIndexMap;
  index2pubkey: Index2PubkeyCache;
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
   * Unique globally shared pubkey registry. There should only exist one for the entire application.
   *
   * TODO: this is a hack, we need a safety mechanism in case a bad eth1 majority vote is in,
   * or handle non finalized data differently, or use an immutable.js structure for cheap copies
   * Warning: may contain pubkeys that do not yet exist in the current state, but do in a later processed state.
   *
   * $VALIDATOR_COUNT x 192 char String -> Number Map
   */
  pubkey2index: PubkeyIndexMap;
  /**
   * Unique globally shared pubkey registry. There should only exist one for the entire application.
   *
   * Warning: may contain indices that do not yet exist in the current state, but do in a later processed state.
   *
   * $VALIDATOR_COUNT x BLST deserialized pubkey (Jacobian coordinates)
   */
  index2pubkey: Index2PubkeyCache;
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
   * Shuffling of validator indexes. Immutable through the epoch, then it's replaced entirely.
   * Note: Per spec definition, shuffling will always be defined. They are never called before loadState()
   *
   * $VALIDATOR_COUNT x Number
   */
  previousShuffling: EpochShuffling;
  /** Same as previousShuffling */
  currentShuffling: EpochShuffling;
  /** Same as previousShuffling */
  nextShuffling: EpochShuffling;
  /**
   * Effective balances, for altair processAttestations()
   */
  effectiveBalanceIncrements: EffectiveBalanceIncrements;
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
   */
  exitQueueEpoch: Epoch;
  /**
   * Number of validators initiating an exit at exitQueueEpoch. May be updated every block as validators are
   * initiateValidatorExit(). This value may vary on each fork of the state.
   *
   * NOTE: Changes block to block
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
  epoch: Epoch;
  syncPeriod: SyncPeriod;

  constructor(data: {
    config: BeaconConfig;
    pubkey2index: PubkeyIndexMap;
    index2pubkey: Index2PubkeyCache;
    proposers: number[];
    proposersPrevEpoch: number[] | null;
    proposersNextEpoch: ProposersDeferred;
    previousShuffling: EpochShuffling;
    currentShuffling: EpochShuffling;
    nextShuffling: EpochShuffling;
    effectiveBalanceIncrements: EffectiveBalanceIncrements;
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
  }) {
    this.config = data.config;
    this.pubkey2index = data.pubkey2index;
    this.index2pubkey = data.index2pubkey;
    this.proposers = data.proposers;
    this.proposersPrevEpoch = data.proposersPrevEpoch;
    this.proposersNextEpoch = data.proposersNextEpoch;
    this.previousShuffling = data.previousShuffling;
    this.currentShuffling = data.currentShuffling;
    this.nextShuffling = data.nextShuffling;
    this.effectiveBalanceIncrements = data.effectiveBalanceIncrements;
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
  }

  /**
   * Create an epoch cache
   * @param validators cached validators that matches `state.validators`
   *
   * SLOW CODE - 🐢
   */
  static createFromState(
    state: BeaconStateAllForks,
    {config, pubkey2index, index2pubkey}: EpochCacheImmutableData,
    opts?: EpochCacheOpts
  ): EpochCache {
    // syncPubkeys here to ensure EpochCacheImmutableData is popualted before computing the rest of caches
    // - computeSyncCommitteeCache() needs a fully populated pubkey2index cache
    if (!opts?.skipSyncPubkeys) {
      syncPubkeys(state, pubkey2index, index2pubkey);
    }

    const currentEpoch = computeEpochAtSlot(state.slot);
    const isGenesis = currentEpoch === GENESIS_EPOCH;
    const previousEpoch = isGenesis ? GENESIS_EPOCH : currentEpoch - 1;
    const nextEpoch = currentEpoch + 1;

    let totalActiveBalanceIncrements = 0;
    let exitQueueEpoch = computeActivationExitEpoch(currentEpoch);
    let exitQueueChurn = 0;

    const validators = state.validators.getAllReadonlyValues();
    const validatorCount = validators.length;

    const effectiveBalanceIncrements = getEffectiveBalanceIncrementsWithLen(validatorCount);
    const previousActiveIndices: ValidatorIndex[] = [];
    const currentActiveIndices: ValidatorIndex[] = [];
    const nextActiveIndices: ValidatorIndex[] = [];

    for (let i = 0; i < validatorCount; i++) {
      const validator = validators[i];

      // Note: Not usable for fork-choice balances since in-active validators are not zero'ed
      effectiveBalanceIncrements[i] = Math.floor(validator.effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);

      if (isActiveValidator(validator, previousEpoch)) {
        previousActiveIndices.push(i);
      }
      if (isActiveValidator(validator, currentEpoch)) {
        currentActiveIndices.push(i);
        // We track totalActiveBalanceIncrements as ETH to fit total network balance in a JS number (53 bits)
        totalActiveBalanceIncrements += effectiveBalanceIncrements[i];
      }
      if (isActiveValidator(validator, nextEpoch)) {
        nextActiveIndices.push(i);
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

    const currentShuffling = computeEpochShuffling(state, currentActiveIndices, currentEpoch);
    const previousShuffling = isGenesis
      ? currentShuffling
      : computeEpochShuffling(state, previousActiveIndices, previousEpoch);
    const nextShuffling = computeEpochShuffling(state, nextActiveIndices, nextEpoch);

    const currentProposerSeed = getSeed(state, currentEpoch, DOMAIN_BEACON_PROPOSER);

    // Allow to create CachedBeaconState for empty states, or no active validators
    const proposers =
      currentShuffling.activeIndices.length > 0
        ? computeProposers(currentProposerSeed, currentShuffling, effectiveBalanceIncrements)
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
    // activeIndices size is dependant on the state epoch. The epoch is advanced after running the epoch transition, and
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
      proposers,
      // On first epoch, set to null to prevent unnecessary work since this is only used for metrics
      proposersPrevEpoch: null,
      proposersNextEpoch,
      previousShuffling,
      currentShuffling,
      nextShuffling,
      effectiveBalanceIncrements,
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
      // Immutable data
      proposers: this.proposers,
      proposersPrevEpoch: this.proposersPrevEpoch,
      proposersNextEpoch: this.proposersNextEpoch,
      previousShuffling: this.previousShuffling,
      currentShuffling: this.currentShuffling,
      nextShuffling: this.nextShuffling,
      // Uint8Array, requires cloning, but it is cloned only when necessary before an epoch transition
      // See EpochCache.beforeEpochTransition()
      effectiveBalanceIncrements: this.effectiveBalanceIncrements,
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
    });
  }

  /**
   * Called to re-use information, such as the shuffling of the next epoch, after transitioning into a
   * new epoch.
   */
  afterProcessEpoch(
    state: BeaconStateAllForks,
    epochTransitionCache: {
      nextEpochShufflingActiveValidatorIndices: ValidatorIndex[];
      nextEpochTotalActiveBalanceByIncrement: number;
    }
  ): void {
    this.previousShuffling = this.currentShuffling;
    this.currentShuffling = this.nextShuffling;
    const currEpoch = this.currentShuffling.epoch;
    const nextEpoch = currEpoch + 1;

    this.nextShuffling = computeEpochShuffling(
      state,
      epochTransitionCache.nextEpochShufflingActiveValidatorIndices,
      nextEpoch
    );

    // Roll current proposers into previous proposers for metrics
    this.proposersPrevEpoch = this.proposers;

    const currentProposerSeed = getSeed(state, this.currentShuffling.epoch, DOMAIN_BEACON_PROPOSER);
    this.proposers = computeProposers(currentProposerSeed, this.currentShuffling, this.effectiveBalanceIncrements);

    // Only pre-compute the seed since it's very cheap. Do the expensive computeProposers() call only on demand.
    this.proposersNextEpoch = {computed: false, seed: getSeed(state, this.nextShuffling.epoch, DOMAIN_BEACON_PROPOSER)};

    // TODO: DEDUPLICATE from createEpochCache
    //
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
    // activeIndices size is dependant on the state epoch. The epoch is advanced after running the epoch transition, and
    // the first block of the epoch process_block() call. So churnLimit must be computed at the end of the before epoch
    // transition and the result is valid until the end of the next epoch transition
    this.churnLimit = getChurnLimit(this.config, this.currentShuffling.activeIndices.length);
    this.activationChurnLimit = getActivationChurnLimit(
      this.config,
      this.config.getForkSeq(state.slot),
      this.currentShuffling.activeIndices.length
    );

    // Maybe advance exitQueueEpoch at the end of the epoch if there haven't been any exists for a while
    const exitQueueEpoch = computeActivationExitEpoch(currEpoch);
    if (exitQueueEpoch > this.exitQueueEpoch) {
      this.exitQueueEpoch = exitQueueEpoch;
      this.exitQueueChurn = 0;
    }

    this.totalActiveBalanceIncrements = epochTransitionCache.nextEpochTotalActiveBalanceByIncrement;
    if (currEpoch >= this.config.ALTAIR_FORK_EPOCH) {
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
  }

  beforeEpochTransition(): void {
    // Clone (copy) before being mutated in processEffectiveBalanceUpdates
    // NOTE: Force to use Uint8Array.slice (copy) instead of Buffer.call (not copy)
    this.effectiveBalanceIncrements = Uint8Array.prototype.slice.call(this.effectiveBalanceIncrements, 0);
  }

  /**
   * Return the beacon committee at slot for index.
   */
  getBeaconCommittee(slot: Slot, index: CommitteeIndex): ValidatorIndex[] {
    const slotCommittees = this.getShufflingAtSlot(slot).committees[slot % SLOTS_PER_EPOCH];
    if (index >= slotCommittees.length) {
      throw new EpochCacheError({
        code: EpochCacheErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
        index,
        maxIndex: slotCommittees.length,
      });
    }
    return slotCommittees[index];
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
        this.proposersNextEpoch.seed,
        this.nextShuffling,
        this.effectiveBalanceIncrements
      );
      this.proposersNextEpoch = {computed: true, indexes};
    }

    return this.proposersNextEpoch.indexes;
  }

  /**
   * Return the indexed attestation corresponding to ``attestation``.
   */
  getIndexedAttestation(attestation: phase0.Attestation): phase0.IndexedAttestation {
    const {aggregationBits, data} = attestation;
    const committeeIndices = this.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = aggregationBits.intersectValues(committeeIndices);

    // sort in-place
    attestingIndices.sort((a, b) => a - b);
    return {
      attestingIndices: attestingIndices,
      data: data,
      signature: attestation.signature,
    };
  }

  getCommitteeAssignments(
    epoch: Epoch,
    requestedValidatorIndices: ValidatorIndex[]
  ): Map<ValidatorIndex, AttesterDuty> {
    const requestedValidatorIndicesSet = new Set(requestedValidatorIndices);
    const duties = new Map<ValidatorIndex, AttesterDuty>();

    const epochCommittees = this.getShufflingAtEpoch(epoch).committees;
    for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
      const slotCommittees = epochCommittees[epochSlot];
      for (let i = 0, committeesAtSlot = slotCommittees.length; i < committeesAtSlot; i++) {
        for (let j = 0, committeeLength = slotCommittees[i].length; j < committeeLength; j++) {
          const validatorIndex = slotCommittees[i][j];
          if (requestedValidatorIndicesSet.has(validatorIndex)) {
            duties.set(validatorIndex, {
              validatorIndex,
              committeeLength,
              committeesAtSlot,
              validatorCommitteeIndex: j,
              committeeIndex: i,
              slot: epoch * SLOTS_PER_EPOCH + epochSlot,
            });
          }
        }
      }
    }

    return duties;
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
            validators: committee,
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

  addPubkey(index: ValidatorIndex, pubkey: Uint8Array): void {
    this.pubkey2index.set(pubkey, index);
    this.index2pubkey[index] = bls.PublicKey.fromBytes(pubkey, CoordType.jacobian); // Optimize for aggregation
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
      throw new EpochCacheError({
        code: EpochCacheErrorCode.COMMITTEE_EPOCH_OUT_OF_RANGE,
        currentEpoch: this.currentShuffling.epoch,
        requestedEpoch: epoch,
      });
    }

    return shuffling;
  }

  getShufflingAtEpochOrNull(epoch: Epoch): EpochShuffling | null {
    if (epoch === this.previousShuffling.epoch) {
      return this.previousShuffling;
    } else if (epoch === this.currentShuffling.epoch) {
      return this.currentShuffling;
    } else if (epoch === this.nextShuffling.epoch) {
      return this.nextShuffling;
    } else {
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
    if (index >= this.effectiveBalanceIncrements.length) {
      // Clone and extend effectiveBalanceIncrements
      const effectiveBalanceIncrements = this.effectiveBalanceIncrements;
      this.effectiveBalanceIncrements = new Uint8Array(getEffectiveBalanceIncrementsByteLen(index + 1));
      this.effectiveBalanceIncrements.set(effectiveBalanceIncrements, 0);
    }

    this.effectiveBalanceIncrements[index] = Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
  }
}

function getEffectiveBalanceIncrementsByteLen(validatorCount: number): number {
  // TODO: Research what's the best number to minimize both memory cost and copy costs
  return 1024 * Math.ceil(validatorCount / 1024);
}

// Copied from lodestar-api package to avoid depending on the package
type AttesterDuty = {
  validatorIndex: ValidatorIndex;
  committeeIndex: CommitteeIndex;
  committeeLength: number;
  committeesAtSlot: number;
  validatorCommitteeIndex: number;
  slot: Slot;
};

export enum EpochCacheErrorCode {
  COMMITTEE_INDEX_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_COMMITTEE_INDEX_OUT_OF_RANGE",
  COMMITTEE_EPOCH_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_COMMITTEE_EPOCH_OUT_OF_RANGE",
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
