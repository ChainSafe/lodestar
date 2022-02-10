import {BitList, List, readonlyValuesListOfLeafNodeStruct} from "@chainsafe/ssz";
import bls, {CoordType} from "@chainsafe/bls";
import {
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Slot,
  ValidatorIndex,
  phase0,
  allForks,
  Number64,
  altair,
  SyncPeriod,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  GENESIS_EPOCH,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {LodestarError} from "@chainsafe/lodestar-utils";

import {
  computeActivationExitEpoch,
  computeEpochAtSlot,
  computeProposers,
  computeStartSlotAtEpoch,
  getChurnLimit,
  isActiveValidator,
  isAggregatorFromCommitteeLength,
  zipIndexesCommitteeBits,
  computeSyncPeriodAtEpoch,
} from "../util";
import {computeEpochShuffling, IEpochShuffling} from "../util/epochShuffling";
import {EffectiveBalanceIncrements, getEffectiveBalanceIncrementsWithLen} from "./effectiveBalanceIncrements";
import {Index2PubkeyCache, PubkeyIndexMap, syncPubkeys} from "./pubkeyCache";
import {
  computeSyncCommitteeCache,
  getSyncCommitteeCache,
  SyncCommitteeCache,
  SyncCommitteeCacheEmpty,
} from "./syncCommitteeCache";
import {computeBaseRewardPerIncrement, computeSyncParticipantReward} from "../util/syncCommittee";

/** `= PROPOSER_WEIGHT / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)` */
export const PROPOSER_WEIGHT_FACTOR = PROPOSER_WEIGHT / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);

export type EpochContextOpts = {
  pubkey2index?: PubkeyIndexMap;
  index2pubkey?: Index2PubkeyCache;
  skipSyncPubkeys?: boolean;
  skipSyncCommitteeCache?: boolean;
};

/**
 * EpochContext is the parent object of:
 * - Any data-structures not part of the spec'ed BeaconState
 * - Necessary to only compute data once
 * - Must be kept at all times through an epoch
 *
 * The performance gains with EpochContext are fundamental for the BeaconNode to be able to participate in a
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
export class EpochContext {
  config: IBeaconConfig;
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
  /**
   * Shuffling of validator indexes. Immutable through the epoch, then it's replaced entirely.
   * Note: Per spec definition, shuffling will always be defined. They are never called before loadState()
   *
   * $VALIDATOR_COUNT x Number
   */
  previousShuffling: IEpochShuffling;
  /** Same as previousShuffling */
  currentShuffling: IEpochShuffling;
  /** Same as previousShuffling */
  nextShuffling: IEpochShuffling;
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
   * Returns a SyncCommitteeCache. (Note: phase0 has no sync committee, and returns an empty cache)
   * - validatorIndices (of the committee members)
   * - validatorIndexMap: Map of ValidatorIndex -> syncCommitteeIndexes
   *
   * The syncCommittee is immutable and changes as a whole every ~ 27h.
   * It contains fixed 512 members so it's rather small.
   */
  currentSyncCommitteeIndexed: SyncCommitteeCache;
  /** Same as currentSyncCommitteeIndexed */
  nextSyncCommitteeIndexed: SyncCommitteeCache;

  // TODO: Helper stats
  epoch: Epoch;
  syncPeriod: SyncPeriod;

  constructor(data: {
    config: IBeaconConfig;
    pubkey2index: PubkeyIndexMap;
    index2pubkey: Index2PubkeyCache;
    proposers: number[];
    previousShuffling: IEpochShuffling;
    currentShuffling: IEpochShuffling;
    nextShuffling: IEpochShuffling;
    effectiveBalanceIncrements: EffectiveBalanceIncrements;
    syncParticipantReward: number;
    syncProposerReward: number;
    baseRewardPerIncrement: number;
    totalActiveBalanceIncrements: number;
    churnLimit: number;
    exitQueueEpoch: Epoch;
    exitQueueChurn: number;
    currentSyncCommitteeIndexed: SyncCommitteeCache;
    nextSyncCommitteeIndexed: SyncCommitteeCache;
    epoch: Epoch;
    syncPeriod: SyncPeriod;
  }) {
    this.config = data.config;
    this.pubkey2index = data.pubkey2index;
    this.index2pubkey = data.index2pubkey;
    this.proposers = data.proposers;
    this.previousShuffling = data.previousShuffling;
    this.currentShuffling = data.currentShuffling;
    this.nextShuffling = data.nextShuffling;
    this.effectiveBalanceIncrements = data.effectiveBalanceIncrements;
    this.syncParticipantReward = data.syncParticipantReward;
    this.syncProposerReward = data.syncProposerReward;
    this.baseRewardPerIncrement = data.baseRewardPerIncrement;
    this.totalActiveBalanceIncrements = data.totalActiveBalanceIncrements;
    this.churnLimit = data.churnLimit;
    this.exitQueueEpoch = data.exitQueueEpoch;
    this.exitQueueChurn = data.exitQueueChurn;
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
  static createFromState(config: IBeaconConfig, state: allForks.BeaconState, opts?: EpochContextOpts): EpochContext {
    const pubkey2index = opts?.pubkey2index || new PubkeyIndexMap();
    const index2pubkey = opts?.index2pubkey || ([] as Index2PubkeyCache);
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

    const validators = readonlyValuesListOfLeafNodeStruct(state.validators);
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

    // Allow to create CachedBeaconState for empty states
    const proposers =
      state.validators.length > 0 ? computeProposers(state, currentShuffling, effectiveBalanceIncrements) : [];

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
      const altairState = state as altair.BeaconState;
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
    if (exitQueueChurn >= churnLimit) {
      exitQueueEpoch += 1;
      exitQueueChurn = 0;
    }

    return new EpochContext({
      config,
      pubkey2index,
      index2pubkey,
      proposers,
      previousShuffling,
      currentShuffling,
      nextShuffling,
      effectiveBalanceIncrements,
      syncParticipantReward,
      syncProposerReward,
      baseRewardPerIncrement,
      totalActiveBalanceIncrements: totalActiveBalanceIncrements,
      churnLimit,
      exitQueueEpoch,
      exitQueueChurn,
      currentSyncCommitteeIndexed,
      nextSyncCommitteeIndexed,
      epoch: currentEpoch,
      syncPeriod: computeSyncPeriodAtEpoch(currentEpoch),
    });
  }

  /**
   * Copies a given EpochContext while avoiding copying its immutable parts.
   */
  copy(): EpochContext {
    // warning: pubkey cache is not copied, it is shared, as eth1 is not expected to reorder validators.
    // Shallow copy all data from current epoch context to the next
    // All data is completely replaced, or only-appended
    return new EpochContext({
      config: this.config,
      // Common append-only structures shared with all states, no need to clone
      pubkey2index: this.pubkey2index,
      index2pubkey: this.index2pubkey,
      // Immutable data
      proposers: this.proposers,
      previousShuffling: this.previousShuffling,
      currentShuffling: this.currentShuffling,
      nextShuffling: this.nextShuffling,
      // Uint8Array, requires cloning, but it is cloned only when necessary before an epoch transition
      // See EpochContext.beforeEpochTransition()
      effectiveBalanceIncrements: this.effectiveBalanceIncrements,
      // Basic types (numbers) cloned implicitly
      syncParticipantReward: this.syncParticipantReward,
      syncProposerReward: this.syncProposerReward,
      baseRewardPerIncrement: this.baseRewardPerIncrement,
      totalActiveBalanceIncrements: this.totalActiveBalanceIncrements,
      churnLimit: this.churnLimit,
      exitQueueEpoch: this.exitQueueEpoch,
      exitQueueChurn: this.exitQueueChurn,
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
    state: allForks.BeaconState,
    epochProcess: {
      nextEpochShufflingActiveValidatorIndices: ValidatorIndex[];
      nextEpochTotalActiveBalanceByIncrement: number;
    }
  ): void {
    this.previousShuffling = this.currentShuffling;
    this.currentShuffling = this.nextShuffling;
    const currEpoch = this.currentShuffling.epoch;
    const nextEpoch = currEpoch + 1;
    this.nextShuffling = computeEpochShuffling(state, epochProcess.nextEpochShufflingActiveValidatorIndices, nextEpoch);
    this.proposers = computeProposers(state, this.currentShuffling, this.effectiveBalanceIncrements);

    // TODO: DEDUPLICATE from createEpochContext
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

    // Maybe advance exitQueueEpoch at the end of the epoch if there haven't been any exists for a while
    const exitQueueEpoch = computeActivationExitEpoch(currEpoch);
    if (exitQueueEpoch > this.exitQueueEpoch) {
      this.exitQueueEpoch = exitQueueEpoch;
      this.exitQueueChurn = 0;
    }

    this.totalActiveBalanceIncrements = epochProcess.nextEpochTotalActiveBalanceByIncrement;
    if (currEpoch >= this.config.ALTAIR_FORK_EPOCH) {
      this.syncParticipantReward = computeSyncParticipantReward(this.totalActiveBalanceIncrements);
      this.syncProposerReward = Math.floor(this.syncParticipantReward * PROPOSER_WEIGHT_FACTOR);
      this.baseRewardPerIncrement = computeBaseRewardPerIncrement(this.totalActiveBalanceIncrements);
    }

    // Advance time units
    // state.slot is advanced right before calling this function
    // ```
    // postState.slot++;
    // afterProcessEpoch(postState, epochProcess);
    // ```
    this.epoch = computeEpochAtSlot(state.slot);
    this.syncPeriod = computeSyncPeriodAtEpoch(this.epoch);
  }

  beforeEpochTransition(): void {
    // Clone before being mutated in processEffectiveBalanceUpdates
    this.effectiveBalanceIncrements = this.effectiveBalanceIncrements.slice(0);
  }

  /**
   * Return the beacon committee at slot for index.
   */
  getBeaconCommittee(slot: Slot, index: CommitteeIndex): ValidatorIndex[] {
    const slotCommittees = this.getShufflingAtSlot(slot).committees[slot % SLOTS_PER_EPOCH];
    if (index >= slotCommittees.length) {
      throw new EpochContextError({
        code: EpochContextErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE,
        index,
        maxIndex: slotCommittees.length,
      });
    }
    return slotCommittees[index];
  }

  getCommitteeCountPerSlot(epoch: Epoch): number {
    return this.getShufflingAtEpoch(epoch).committeesPerSlot;
  }

  getBeaconProposer(slot: Slot): ValidatorIndex {
    const epoch = computeEpochAtSlot(slot);
    if (epoch !== this.currentShuffling.epoch) {
      throw new Error(
        `Requesting beacon proposer for different epoch current shuffling: ${epoch} != ${this.currentShuffling.epoch}`
      );
    }
    return this.proposers[slot % SLOTS_PER_EPOCH];
  }

  /**
   * Return the indexed attestation corresponding to ``attestation``.
   */
  getIndexedAttestation(attestation: phase0.Attestation): phase0.IndexedAttestation {
    const {aggregationBits, data} = attestation;
    const committeeIndices = this.getBeaconCommittee(data.slot, data.index);
    const attestingIndices = zipIndexesCommitteeBits(committeeIndices, aggregationBits);

    // sort in-place
    attestingIndices.sort((a, b) => a - b);
    return {
      attestingIndices: attestingIndices as List<number>,
      data: data,
      signature: attestation.signature,
    };
  }

  getAttestingIndices(data: phase0.AttestationData, bits: BitList): ValidatorIndex[] {
    const committeeIndices = this.getBeaconCommittee(data.slot, data.index);
    const validatorIndices = zipIndexesCommitteeBits(committeeIndices, bits);
    return validatorIndices;
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
            // no-non-null-assertion: We know that if index is in set there must exist an entry in the map
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
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
            validators: committee as List<number>,
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

  getShufflingAtSlot(slot: Slot): IEpochShuffling {
    const epoch = computeEpochAtSlot(slot);
    return this.getShufflingAtEpoch(epoch);
  }

  getShufflingAtEpoch(epoch: Epoch): IEpochShuffling {
    if (epoch === this.previousShuffling.epoch) {
      return this.previousShuffling;
    } else if (epoch === this.currentShuffling.epoch) {
      return this.currentShuffling;
    } else if (epoch === this.nextShuffling.epoch) {
      return this.nextShuffling;
    } else {
      throw new Error(`Requesting slot committee out of range epoch: ${epoch} current: ${this.currentShuffling.epoch}`);
    }
  }

  effectiveBalanceIncrementsSet(index: number, effectiveBalance: number): void {
    if (index >= this.effectiveBalanceIncrements.length) {
      // Clone and extend effectiveBalanceIncrements
      const effectiveBalanceIncrements = this.effectiveBalanceIncrements;
      // Note: getEffectiveBalanceIncrementsWithLen() returns a Uint8Array larger than `index + 1` to reduce copy-ing
      this.effectiveBalanceIncrements = getEffectiveBalanceIncrementsWithLen(index + 1);
      this.effectiveBalanceIncrements.set(effectiveBalanceIncrements, 0);
    }

    this.effectiveBalanceIncrements[index] = Math.floor(effectiveBalance / EFFECTIVE_BALANCE_INCREMENT);
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
   * **DO NOT USE FOR GOSSIP VALIDATION**: Sync committee duties are offset by one slot. @see {@link EpochContext.getIndexedSyncCommittee}
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
        throw new Error(`No sync committee for epoch ${epoch}`);
    }
  }

  /** On processSyncCommitteeUpdates rotate next to current and set nextSyncCommitteeIndexed */
  rotateSyncCommitteeIndexed(nextSyncCommitteeIndices: number[]): void {
    this.currentSyncCommitteeIndexed = this.nextSyncCommitteeIndexed;
    this.nextSyncCommitteeIndexed = getSyncCommitteeCache(nextSyncCommitteeIndices);
  }
}

// Copied from lodestar-api package to avoid depending on the package
type AttesterDuty = {
  validatorIndex: ValidatorIndex;
  committeeIndex: CommitteeIndex;
  committeeLength: Number64;
  committeesAtSlot: Number64;
  validatorCommitteeIndex: Number64;
  slot: Slot;
};

export enum EpochContextErrorCode {
  COMMITTEE_INDEX_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_COMMITTEE_INDEX_OUT_OF_RANGE",
}

type EpochContextErrorType = {
  code: EpochContextErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE;
  index: number;
  maxIndex: number;
};

export class EpochContextError extends LodestarError<EpochContextErrorType> {}
