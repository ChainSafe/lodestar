import {ByteVector, hash, toHexString, BitList, List, readonlyValuesListOfLeafNodeStruct} from "@chainsafe/ssz";
import bls, {CoordType, PublicKey} from "@chainsafe/bls";
import {
  BLSSignature,
  CommitteeIndex,
  Epoch,
  Slot,
  ValidatorIndex,
  allForks,
  Gwei,
  Number64,
  ssz,
  phase0,
  altair,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {
  BASE_REWARD_FACTOR,
  DOMAIN_BEACON_PROPOSER,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  GENESIS_EPOCH,
  PROPOSER_WEIGHT,
  SLOTS_PER_EPOCH,
  SYNC_COMMITTEE_SIZE,
  SYNC_REWARD_WEIGHT,
  WEIGHT_DENOMINATOR,
} from "@chainsafe/lodestar-params";
import {bigIntMax, bigIntSqrt, intToBytes, LodestarError} from "@chainsafe/lodestar-utils";

import {
  computeActivationExitEpoch,
  computeEpochAtSlot,
  computeProposerIndex,
  computeStartSlotAtEpoch,
  getChurnLimit,
  getSeed,
  isActiveValidator,
  isAggregatorFromCommitteeLength,
  zipIndexesCommitteeBits,
} from "../../util";
import {computeEpochShuffling, IEpochShuffling} from "./epochShuffling";
import {MutableVector} from "@chainsafe/persistent-ts";
import {computeBaseRewardPerIncrement} from "../../altair/util/misc";
import {CachedBeaconState} from "./cachedBeaconState";
import {IEpochProcess} from "./epochProcess";

export type AttesterDuty = {
  // Index of validator in validator registry
  validatorIndex: ValidatorIndex;
  committeeIndex: CommitteeIndex;
  // Number of validators in committee
  committeeLength: Number64;
  // Number of committees at the provided slot
  committeesAtSlot: Number64;
  // Index of validator in committee
  validatorCommitteeIndex: Number64;
  // The slot at which the validator must attest.
  slot: Slot;
};

export type EpochContextOpts = {
  pubkey2index?: PubkeyIndexMap;
  index2pubkey?: PublicKey[];
  skipSyncPubkeys?: boolean;
};

type PubkeyHex = string;

function toHexStringMaybe(hex: ByteVector | string): string {
  return typeof hex === "string" ? hex : toHexString(hex);
}

export class PubkeyIndexMap {
  // We don't really need the full pubkey. We could just use the first 20 bytes like an Ethereum address
  private readonly map = new Map<PubkeyHex, ValidatorIndex>();

  get size(): number {
    return this.map.size;
  }

  get(key: ByteVector | PubkeyHex): ValidatorIndex | undefined {
    return this.map.get(toHexStringMaybe(key));
  }

  set(key: ByteVector | PubkeyHex, value: ValidatorIndex): void {
    this.map.set(toHexStringMaybe(key), value);
  }
}

/**
 * Create an epoch cache
 * @param validators cached validators that matches `state.validators`
 *
 * SLOW CODE - 🐢
 */
export function createEpochContext(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  opts?: EpochContextOpts
): EpochContext {
  const pubkey2index = opts?.pubkey2index || new PubkeyIndexMap();
  const index2pubkey = opts?.index2pubkey || ([] as PublicKey[]);
  if (!opts?.skipSyncPubkeys) {
    syncPubkeys(state, pubkey2index, index2pubkey);
  }

  const currentEpoch = computeEpochAtSlot(state.slot);
  const previousEpoch = currentEpoch === GENESIS_EPOCH ? GENESIS_EPOCH : currentEpoch - 1;
  const nextEpoch = currentEpoch + 1;

  let totalActiveBalance = BigInt(0);
  let exitQueueEpoch = computeActivationExitEpoch(currentEpoch);
  let exitQueueChurn = 0;

  const previousActiveIndices: ValidatorIndex[] = [];
  const currentActiveIndices: ValidatorIndex[] = [];
  const nextActiveIndices: ValidatorIndex[] = [];
  const effectiveBalancesArr: Gwei[] = [];

  const validators = readonlyValuesListOfLeafNodeStruct(state.validators);
  const validatorCount = validators.length;

  for (let i = 0; i < validatorCount; i++) {
    const validator = validators[i];

    if (isActiveValidator(validator, previousEpoch)) {
      previousActiveIndices.push(i);
    }
    if (isActiveValidator(validator, currentEpoch)) {
      currentActiveIndices.push(i);
      totalActiveBalance += validator.effectiveBalance;
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

    // TODO: Should have 0 for not active validators to be re-usable in ForkChoice
    effectiveBalancesArr.push(validator.effectiveBalance);
  }

  // Spec: `EFFECTIVE_BALANCE_INCREMENT` Gwei minimum to avoid divisions by zero
  if (totalActiveBalance < EFFECTIVE_BALANCE_INCREMENT) {
    totalActiveBalance = EFFECTIVE_BALANCE_INCREMENT;
  }

  const currentShuffling = computeEpochShuffling(state, currentActiveIndices, currentEpoch);
  const previousShuffling =
    previousEpoch === currentEpoch
      ? // in case of genesis
        currentShuffling
      : computeEpochShuffling(state, previousActiveIndices, previousEpoch);
  const nextShuffling = computeEpochShuffling(state, nextActiveIndices, nextEpoch);

  // Allow to create CachedBeaconState for empty states
  const proposers = state.validators.length > 0 ? computeProposers(state, currentShuffling) : [];

  // Only after altair, compute the indices of the current sync committee
  const onAltairFork = currentEpoch >= config.ALTAIR_FORK_EPOCH;

  const syncParticipantReward = onAltairFork ? computeSyncParticipantReward(config, totalActiveBalance) : BigInt(0);
  const syncProposerReward = onAltairFork
    ? (syncParticipantReward * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT)
    : BigInt(0);

  const baseRewardPerIncrement = onAltairFork ? computeBaseRewardPerIncrement(totalActiveBalance) : BigInt(0);

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
    syncParticipantReward,
    syncProposerReward,
    baseRewardPerIncrement,
    effectiveBalances: MutableVector.from(effectiveBalancesArr),
    churnLimit,
    exitQueueEpoch,
    exitQueueChurn,
  });
}

/**
 * Checks the pubkey indices against a state and adds missing pubkeys
 *
 * Mutates `pubkey2index` and `index2pubkey`
 *
 * If pubkey caches are empty: SLOW CODE - 🐢
 */
export function syncPubkeys(
  state: allForks.BeaconState,
  pubkey2index: PubkeyIndexMap,
  index2pubkey: PublicKey[]
): void {
  const currentCount = pubkey2index.size;
  if (currentCount !== index2pubkey.length) {
    throw new Error(`Pubkey indices have fallen out of sync: ${currentCount} != ${index2pubkey.length}`);
  }

  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  const newCount = state.validators.length;
  for (let i = currentCount; i < newCount; i++) {
    const pubkey = validators[i].pubkey.valueOf() as Uint8Array;
    pubkey2index.set(pubkey, i);
    // Pubkeys must be checked for group + inf. This must be done only once when the validator deposit is processed.
    // Afterwards any public key is the state consider validated.
    // > Do not do any validation here
    index2pubkey.push(bls.PublicKey.fromBytes(pubkey, CoordType.jacobian)); // Optimize for aggregation
  }
}

/**
 * Compute proposer indices for an epoch
 */
export function computeProposers(state: allForks.BeaconState, shuffling: IEpochShuffling): number[] {
  const epochSeed = getSeed(state, shuffling.epoch, DOMAIN_BEACON_PROPOSER);
  const startSlot = computeStartSlotAtEpoch(shuffling.epoch);
  const proposers = [];
  for (let slot = startSlot; slot < startSlot + SLOTS_PER_EPOCH; slot++) {
    proposers.push(
      computeProposerIndex(state, shuffling.activeIndices, hash(Buffer.concat([epochSeed, intToBytes(slot, 8)])))
    );
  }
  return proposers;
}

/**
 * Same logic in https://github.com/ethereum/eth2.0-specs/blob/v1.1.0-alpha.5/specs/altair/beacon-chain.md#sync-committee-processing
 */
export function computeSyncParticipantReward(config: IBeaconConfig, totalActiveBalance: Gwei): Gwei {
  const totalActiveIncrements = totalActiveBalance / EFFECTIVE_BALANCE_INCREMENT;
  const baseRewardPerIncrement =
    (EFFECTIVE_BALANCE_INCREMENT * BigInt(BASE_REWARD_FACTOR)) / bigIntSqrt(totalActiveBalance);
  const totalBaseRewards = baseRewardPerIncrement * totalActiveIncrements;
  const maxParticipantRewards = (totalBaseRewards * SYNC_REWARD_WEIGHT) / WEIGHT_DENOMINATOR / BigInt(SLOTS_PER_EPOCH);
  return maxParticipantRewards / BigInt(SYNC_COMMITTEE_SIZE);
}

/**
 * Runs just after running an epoch transition on state. It is used to prepare data useful for the entire length of the
 * next epoch at the at the cost of added memory.
 *
 * ```js
 * beforeProcessEpoch(); // before epoch transition hook
 * epochTransition();
 * postState.slot++;
 * afterProcessEpoch(); // after epoch transition hook
 * ```
 */
export function afterProcessEpoch(
  state:
    | CachedBeaconState<phase0.BeaconState>
    | CachedBeaconState<altair.BeaconState>
    | CachedBeaconState<allForks.BeaconState>,
  epochProcess: IEpochProcess
): void {
  const {epochCtx} = state;

  // Rotate shufflings
  epochCtx.previousShuffling = epochCtx.currentShuffling;
  epochCtx.currentShuffling = epochCtx.nextShuffling;

  const currEpoch = epochCtx.currentShuffling.epoch;
  const nextEpoch = currEpoch + 1;
  epochCtx.nextShuffling = computeEpochShuffling(
    state,
    epochProcess.nextEpochShufflingActiveValidatorIndices,
    nextEpoch
  );
  epochCtx.proposers = computeProposers(state, epochCtx.currentShuffling);

  // Commit mutated flat balances to the state tree
  // TODO: Improve typings and benchmark to maybe use a faster strategy
  // SLOW CODE - 🐢🐢🐢🐢🐢🐢🐢🐢🐢🐢
  state.balances = ssz.phase0.Balances.createTreeBackedFromStruct(
    (epochProcess.balancesFlat as unknown) as List<bigint>
  );

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
  epochCtx.churnLimit = getChurnLimit(epochCtx.config, epochCtx.currentShuffling.activeIndices.length);

  // Maybe advance exitQueueEpoch at the end of the epoch if there haven't been any exists for a while
  const exitQueueEpoch = computeActivationExitEpoch(currEpoch);
  if (exitQueueEpoch > epochCtx.exitQueueEpoch) {
    epochCtx.exitQueueEpoch = exitQueueEpoch;
    epochCtx.exitQueueChurn = 0;
  }

  if (currEpoch >= epochCtx.config.ALTAIR_FORK_EPOCH) {
    // To pass spec tests, force to EFFECTIVE_BALANCE_INCREMENT since nextEpochTotalActiveBalance may be zero
    const totalActiveBalance = bigIntMax(epochProcess.nextEpochTotalActiveBalance, EFFECTIVE_BALANCE_INCREMENT);
    epochCtx.syncParticipantReward = computeSyncParticipantReward(epochCtx.config, totalActiveBalance);
    epochCtx.syncProposerReward =
      (epochCtx.syncParticipantReward * PROPOSER_WEIGHT) / (WEIGHT_DENOMINATOR - PROPOSER_WEIGHT);

    epochCtx.baseRewardPerIncrement = computeBaseRewardPerIncrement(totalActiveBalance);
  }
}

interface IEpochContextData {
  config: IBeaconConfig;
  pubkey2index: PubkeyIndexMap;
  index2pubkey: PublicKey[];
  proposers: number[];
  previousShuffling: IEpochShuffling;
  currentShuffling: IEpochShuffling;
  nextShuffling: IEpochShuffling;
  syncParticipantReward: Gwei;
  syncProposerReward: Gwei;
  baseRewardPerIncrement: Gwei;
  effectiveBalances: MutableVector<Gwei>;
  churnLimit: number;
  exitQueueEpoch: Epoch;
  exitQueueChurn: number;
}

/**
 * Cached persisted data constant through an epoch attached to a state:
 * - pubkey cache
 * - proposer indexes
 * - shufflings
 *
 * This data is used for faster processing of the beacon-state-transition-function plus gossip and API validation.
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
  index2pubkey: PublicKey[];
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
  syncParticipantReward: phase0.Gwei;
  syncProposerReward: phase0.Gwei;
  /**
   * Update freq: once per epoch after `process_effective_balance_updates()`
   * Memory cost: 1 bigint
   */
  baseRewardPerIncrement: Gwei;
  /**
   * Effective balances, for altair processAttestations()
   */
  effectiveBalances: MutableVector<Gwei>;
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

  constructor(data: IEpochContextData) {
    this.config = data.config;
    this.pubkey2index = data.pubkey2index;
    this.index2pubkey = data.index2pubkey;
    this.proposers = data.proposers;
    this.previousShuffling = data.previousShuffling;
    this.currentShuffling = data.currentShuffling;
    this.nextShuffling = data.nextShuffling;
    this.syncParticipantReward = data.syncParticipantReward;
    this.syncProposerReward = data.syncProposerReward;
    this.baseRewardPerIncrement = data.baseRewardPerIncrement;
    this.effectiveBalances = data.effectiveBalances;
    this.churnLimit = data.churnLimit;
    this.exitQueueEpoch = data.exitQueueEpoch;
    this.exitQueueChurn = data.exitQueueChurn;
  }

  /**
   * Copies a given EpochContext while avoiding copying its immutable parts.
   */
  copy(): EpochContext {
    // warning: pubkey cache is not copied, it is shared, as eth1 is not expected to reorder validators.
    // Shallow copy all data from current epoch context to the next
    // All data is completely replaced, or only-appended
    return new EpochContext(this);
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

  getCommitteeAssignments(epoch: Epoch, requestedValidatorIndices: ValidatorIndex[]): AttesterDuty[] {
    const requestedValidatorIndicesSet = new Set(requestedValidatorIndices);
    const duties = [];
    const epochCommittees = this.getShufflingAtEpoch(epoch).committees;
    for (let epochSlot = 0; epochSlot < SLOTS_PER_EPOCH; epochSlot++) {
      const slotCommittees = epochCommittees[epochSlot];
      for (let i = 0, committeesAtSlot = slotCommittees.length; i < committeesAtSlot; i++) {
        for (let j = 0, committeeLength = slotCommittees[i].length; j < committeeLength; j++) {
          const validatorIndex = slotCommittees[i][j];
          if (requestedValidatorIndicesSet.has(validatorIndex)) {
            duties.push({
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
}

export enum EpochContextErrorCode {
  COMMITTEE_INDEX_OUT_OF_RANGE = "EPOCH_CONTEXT_ERROR_COMMITTEE_INDEX_OUT_OF_RANGE",
}

type EpochContextErrorType = {
  code: EpochContextErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE;
  index: number;
  maxIndex: number;
};

export class EpochContextError extends LodestarError<EpochContextErrorType> {}
