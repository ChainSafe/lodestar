import {digest} from "@chainsafe/as-sha256";
import {BitArray} from "@chainsafe/ssz";
import {
  ATTESTATION_COMMITTEES_PER_ROUND,
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  DOMAIN_FINALITY_ATTESTER,
  DOMAIN_HEAD_VOTE,
  DOMAIN_HEAD_VOTE_COMMITTEE,
  DOMAIN_INCLUSION_LIST_COMMITTEE,
  DOMAIN_PTC_ATTESTER,
  EFFECTIVE_BALANCE_INCREMENT,
  EJECTION_INACTIVITY_SCORE,
  GENESIS_ROUND,
  GENESIS_SLOT,
  HEAD_VOTE_COMMITTEE_SIZE,
  INCLUSION_LIST_COMMITTEE_SIZE,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MAX_VALIDATORS_PER_AGGREGATE,
  MIN_ROUNDS_TO_INACTIVITY_LEAK,
  PTC_SIZE,
  ROUND_REWARD_FACTOR,
  SLOTS_PER_ROUND,
} from "@lodestar/params";
import {Epoch, Root, Slot, ValidatorIndex, eip8453, ssz} from "@lodestar/types";
import {bigIntSqrt, bnToNum, byteArrayEquals, intToBytes} from "@lodestar/utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateEip8453} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";
import {computeShuffledIndex, getSeed} from "./seed.js";
import {createAggregateSignatureSetFromComponents, verifySignatureSet} from "./signatureSets.js";
import {computeSigningRoot} from "./signingRoot.js";
import {getActiveValidatorIndices, isActiveValidator} from "./validator.js";

/**
 * Helpers of specs/_features/eip8453/beacon-chain.md (ethereum/consensus-specs, branch decoupled-consensus).
 * Function names follow the spec; the comment above each one names the spec function.
 */

export type Round = number;

/** A height checkpoint read out of a view, or built by hand */
export type HeightCheckpointLike = {height: number; root: Uint8Array};

const MAX_RANDOM_VALUE = 2 ** 16 - 1;
const MAX_EFFECTIVE_BALANCE_INCREMENTS = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

// Misc

export function isZeroRoot(root: Uint8Array): boolean {
  return byteArrayEquals(root, ZERO_HASH);
}

/** `HeightCheckpoint.empty()`, the absent finality pair */
export function isEmptyHeightCheckpoint(checkpoint: {height: number | bigint; root: Uint8Array}): boolean {
  return Number(checkpoint.height) === 0 && isZeroRoot(checkpoint.root);
}

export function heightCheckpointEquals(
  a: {height: number | bigint; root: Uint8Array},
  b: {height: number | bigint; root: Uint8Array}
): boolean {
  return a.height === b.height && byteArrayEquals(a.root, b.root);
}

/** Read through the view getters so uncommitted writes from process_slot are visible, unlike toValue() */
export function readHeightCheckpoint(view: {height: number; root: Uint8Array}): HeightCheckpointLike {
  return {height: view.height, root: view.root};
}

// Spec: compute_round_at_slot
export function computeRoundAtSlot(slot: Slot): Round {
  return Math.floor(slot / SLOTS_PER_ROUND);
}

// Spec: compute_start_slot_at_round
export function computeStartSlotAtRound(round: Round): Slot {
  return round * SLOTS_PER_ROUND;
}

// Spec: compute_attestation_committee_slot
export function computeAttestationCommitteeSlot(round: Round, committeeIndex: number): Slot {
  const committeesPerSlot = Math.floor(ATTESTATION_COMMITTEES_PER_ROUND / SLOTS_PER_ROUND);
  return computeStartSlotAtRound(round) + Math.floor(committeeIndex / committeesPerSlot);
}

// Spec: get_current_round
export function getCurrentRound(state: {slot: Slot}): Round {
  return computeRoundAtSlot(state.slot);
}

// Spec: get_previous_round
export function getPreviousRound(state: {slot: Slot}): Round {
  const currentRound = getCurrentRound(state);
  return currentRound === GENESIS_ROUND ? GENESIS_ROUND : currentRound - 1;
}

// Predicates

// Spec: is_well_formed_attestation_data
export function isWellFormedAttestationData(data: eip8453.AttestationData): boolean {
  if (data.target.height === 0 || isZeroRoot(data.target.root)) {
    return false;
  }
  if (isEmptyHeightCheckpoint(data.finality)) {
    return true;
  }
  return !isZeroRoot(data.finality.root) && data.finality.height < data.target.height;
}

// Spec: is_valid_attestation_data
export function isValidAttestationData(state: CachedBeaconStateEip8453, data: eip8453.AttestationData): boolean {
  const targetCheckpoint = readHeightCheckpoint(state.targetCheckpoint);
  if (heightCheckpointEquals(data.target, targetCheckpoint)) {
    return true;
  }
  if (!(data.finality.height < data.target.height && data.target.height < targetCheckpoint.height)) {
    return false;
  }
  for (const pending of state.pendingFinality.getAllReadonly()) {
    if (heightCheckpointEquals(pending.checkpoint, data.finality)) {
      return true;
    }
  }
  return false;
}

type AttestationDataLike<H extends number | bigint> = {
  target: {height: H; root: Uint8Array};
  timeout: boolean;
  finality: {height: H; root: Uint8Array};
};

// Spec: is_double_target_vote
export function isDoubleTargetVote<H extends number | bigint>(
  data1: AttestationDataLike<H>,
  data2: AttestationDataLike<H>
): boolean {
  if (data1.timeout || data2.timeout) {
    return false;
  }
  if (data1.target.height !== data2.target.height) {
    return false;
  }
  return !byteArrayEquals(data1.target.root, data2.target.root);
}

// Spec: is_conflicting_with_finality_pair
export function isConflictingWithFinalityPair<H extends number | bigint>(
  data: AttestationDataLike<H>,
  finality: {height: H; root: Uint8Array}
): boolean {
  if (isEmptyHeightCheckpoint(finality)) {
    return false;
  }
  if (data.target.height !== finality.height) {
    return false;
  }
  if (data.timeout) {
    return true;
  }
  return !byteArrayEquals(data.target.root, finality.root);
}

// Spec: is_slashable_attestation_data [Modified in EIP8453]
export function isSlashableAttestationDataEip8453<H extends number | bigint>(
  data1: AttestationDataLike<H>,
  data2: AttestationDataLike<H>
): boolean {
  return (
    isDoubleTargetVote(data1, data2) ||
    isConflictingWithFinalityPair(data1, data2.finality) ||
    isConflictingWithFinalityPair(data2, data1.finality)
  );
}

// Spec: is_head_vote_same_slot
export function isHeadVoteSameSlot(state: CachedBeaconStateEip8453, data: eip8453.HeadVoteData): boolean {
  if (data.slot === GENESIS_SLOT) {
    return true;
  }
  if (!byteArrayEquals(data.beaconBlockRoot, getBlockRootAtSlot(state, data.slot))) {
    return false;
  }
  return !byteArrayEquals(data.beaconBlockRoot, getBlockRootAtSlot(state, data.slot - 1));
}

// Spec: has_builder_payment_quorum
export function hasBuilderPaymentQuorum(participation: BitArray): boolean {
  const seats = participation.getTrueBitIndexes().length;
  return (
    seats * BUILDER_PAYMENT_THRESHOLD_DENOMINATOR >= HEAD_VOTE_COMMITTEE_SIZE * BUILDER_PAYMENT_THRESHOLD_NUMERATOR
  );
}

// Spec: is_valid_aggregation_bits
export function isValidAggregationBits(
  state: CachedBeaconStateEip8453,
  epoch: Epoch,
  aggregate: eip8453.Attestation
): boolean {
  let committeesSize = 0;
  for (const committeeIndex of aggregate.committeeBits.getTrueBitIndexes()) {
    committeesSize += getAttestationCommittee(state, epoch, committeeIndex).length;
  }
  if (committeesSize > MAX_VALIDATORS_PER_AGGREGATE) {
    return false;
  }
  return aggregate.aggregationBits.bitLen === committeesSize;
}

// Beacon state accessors

/** `get_active_validator_indices(state, epoch)`, served from the epoch cache when the epoch is cached */
export function getActiveIndicesAtEpoch(state: CachedBeaconStateEip8453, epoch: Epoch): Uint32Array {
  const {epochCtx} = state;
  if (epoch === epochCtx.epoch) return epochCtx.currentShuffling.activeIndices;
  if (epoch === epochCtx.previousShuffling.epoch) return epochCtx.previousShuffling.activeIndices;
  if (epoch === epochCtx.nextShuffling.epoch) return epochCtx.nextShuffling.activeIndices;
  return getActiveValidatorIndices(state, epoch);
}

/**
 * Spec: get_attestation_committee
 * The active validators are not shuffled. They are split evenly into ATTESTATION_COMMITTEES_PER_ROUND committees,
 * in index order rotated by `epoch`, so each validator sits on exactly one.
 */
export function getAttestationCommittee(
  state: CachedBeaconStateEip8453,
  epoch: Epoch,
  committeeIndex: number
): Uint32Array {
  const indices = getActiveIndicesAtEpoch(state, epoch);
  const count = indices.length;
  if (count === 0) {
    return new Uint32Array(0);
  }
  const start = Math.floor((count * committeeIndex) / ATTESTATION_COMMITTEES_PER_ROUND);
  const end = Math.floor((count * (committeeIndex + 1)) / ATTESTATION_COMMITTEES_PER_ROUND);
  const committee = new Uint32Array(end - start);
  for (let position = start; position < end; position++) {
    committee[position - start] = indices[(position + epoch) % count];
  }
  return committee;
}

/** Spec: get_attestation_committee_assignment (validator.md), the committee a validator sits on in `epoch` */
export function getAttestationCommitteeAssignment(
  state: CachedBeaconStateEip8453,
  epoch: Epoch,
  validatorIndex: ValidatorIndex
): number | null {
  const indices = getActiveIndicesAtEpoch(state, epoch);
  const count = indices.length;
  for (let position = 0; position < count; position++) {
    if (indices[(position + epoch) % count] === validatorIndex) {
      // committee c covers positions [count*c/N, count*(c+1)/N), so c = floor((position*N + N - 1) / count) - 1 ... search instead
      let lo = 0;
      let hi = ATTESTATION_COMMITTEES_PER_ROUND - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        const end = Math.floor((count * (mid + 1)) / ATTESTATION_COMMITTEES_PER_ROUND);
        if (position < end) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    }
  }
  return null;
}

/**
 * Spec: get_aggregate_participants
 * Throws on a bitlist shorter than the selected committees, as the pyspec raises an IndexError there.
 */
export function getAggregateParticipants(
  state: CachedBeaconStateEip8453,
  epoch: Epoch,
  aggregate: eip8453.Attestation
): ValidatorIndex[] {
  const {aggregationBits, committeeBits} = aggregate;
  const participants: ValidatorIndex[] = [];
  let committeeOffset = 0;
  for (const committeeIndex of committeeBits.getTrueBitIndexes()) {
    const committee = getAttestationCommittee(state, epoch, committeeIndex);
    if (aggregationBits.bitLen < committeeOffset + committee.length) {
      throw Error(
        `Aggregation bits too short: bitLen=${aggregationBits.bitLen} needed=${committeeOffset + committee.length}`
      );
    }
    for (let i = 0; i < committee.length; i++) {
      if (aggregationBits.get(committeeOffset + i)) {
        participants.push(committee[i]);
      }
    }
    committeeOffset += committee.length;
  }
  return participants;
}

// Spec: get_attesting_indices [Modified in EIP8453]
export function getAttestingIndicesEip8453(
  state: CachedBeaconStateEip8453,
  attestation: eip8453.Attestation
): ValidatorIndex[] {
  return getAggregateParticipants(state, attestation.epoch, attestation);
}

// Spec: get_indexed_attestation [Modified in EIP8453]
export function getIndexedAttestationEip8453(
  state: CachedBeaconStateEip8453,
  attestation: eip8453.Attestation
): eip8453.IndexedAttestation {
  const attestingIndices = getAttestingIndicesEip8453(state, attestation);
  attestingIndices.sort((a, b) => a - b);
  return {attestingIndices, data: attestation.data, signature: attestation.signature, epoch: attestation.epoch};
}

/** `get_domain(state, DOMAIN_FINALITY_ATTESTER, epoch)` then `compute_signing_root(data, domain)` */
export function getFinalityAttestationSigningRoot(
  state: CachedBeaconStateEip8453,
  data: eip8453.AttestationData,
  epoch: Epoch
): Uint8Array {
  const domain = state.config.getDomain(state.slot, DOMAIN_FINALITY_ATTESTER, computeStartSlotAtEpoch(epoch));
  return computeSigningRoot(ssz.eip8453.AttestationData, data, domain);
}

/** Bigint variant for attester slashings, whose heights and epoch are unbounded */
export function getFinalityAttestationBigintSigningRoot(
  state: CachedBeaconStateEip8453,
  data: eip8453.AttestationDataBigint,
  epoch: bigint
): Uint8Array {
  const domain = state.config.getDomain(state.slot, DOMAIN_FINALITY_ATTESTER, computeStartSlotAtEpoch(Number(epoch)));
  return computeSigningRoot(ssz.eip8453.AttestationDataBigint, data, domain);
}

export function isValidIndexedAttestationIndicesEip8453(validatorsLen: number, indices: ArrayLike<number>): boolean {
  if (indices.length === 0 || indices.length > MAX_VALIDATORS_PER_AGGREGATE) {
    return false;
  }
  let prev = -1;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] <= prev) return false;
    prev = indices[i];
  }
  return prev < validatorsLen;
}

// Spec: is_valid_indexed_attestation [Modified in EIP8453]
export function isValidIndexedAttestationEip8453(
  state: CachedBeaconStateEip8453,
  indexedAttestation: eip8453.IndexedAttestation,
  verifySignature: boolean
): boolean {
  if (!isValidIndexedAttestationIndicesEip8453(state.validators.length, indexedAttestation.attestingIndices)) {
    return false;
  }
  if (!verifySignature) {
    return true;
  }
  return verifySignatureSet(
    createAggregateSignatureSetFromComponents(
      indexedAttestation.attestingIndices,
      getFinalityAttestationSigningRoot(state, indexedAttestation.data, indexedAttestation.epoch),
      indexedAttestation.signature
    )
  );
}

export function isValidIndexedAttestationBigintEip8453(
  state: CachedBeaconStateEip8453,
  indexedAttestation: eip8453.IndexedAttestationBigint,
  verifySignature: boolean
): boolean {
  if (!isValidIndexedAttestationIndicesEip8453(state.validators.length, indexedAttestation.attestingIndices)) {
    return false;
  }
  if (!verifySignature) {
    return true;
  }
  return verifySignatureSet(
    createAggregateSignatureSetFromComponents(
      indexedAttestation.attestingIndices,
      getFinalityAttestationBigintSigningRoot(state, indexedAttestation.data, indexedAttestation.epoch),
      indexedAttestation.signature
    )
  );
}

/** `get_domain(state, DOMAIN_HEAD_VOTE, compute_epoch_at_slot(data.slot))` then `compute_signing_root` */
export function getHeadVoteSigningRoot(state: CachedBeaconStateEip8453, data: eip8453.HeadVoteData): Uint8Array {
  const domain = state.config.getDomain(state.slot, DOMAIN_HEAD_VOTE, data.slot);
  return computeSigningRoot(ssz.eip8453.HeadVoteData, data, domain);
}

// Weights

/**
 * Spec: get_validator_weight
 * Every validator has the same weight regardless of balance, reduced with the square of its inactivity score.
 */
export function getValidatorWeight(inactivityScore: number): number {
  const score = Math.min(inactivityScore, EJECTION_INACTIVITY_SCORE);
  return (EJECTION_INACTIVITY_SCORE - score) * (EJECTION_INACTIVITY_SCORE + score);
}

/**
 * Weight sums are at most `validators * EJECTION_INACTIVITY_SCORE**2 = validators * 2**32`, which fits a JS
 * number for up to 2**21 validators. Throw rather than silently lose precision beyond that.
 */
function checkedWeightSum(sum: number): number {
  if (sum > Number.MAX_SAFE_INTEGER) {
    throw Error("Finality gadget weight sum exceeds Number.MAX_SAFE_INTEGER");
  }
  return sum;
}

// Spec: get_total_weight, over the active validators of the current epoch
export function getTotalActiveWeight(state: CachedBeaconStateEip8453, inactivityScores: number[]): number {
  let total = 0;
  for (const index of state.epochCtx.currentShuffling.activeIndices) {
    total += getValidatorWeight(inactivityScores[index]);
  }
  return checkedWeightSum(total);
}

// Spec: get_participating_weight
export function getParticipatingWeight(
  state: CachedBeaconStateEip8453,
  inactivityScores: number[],
  participation: boolean[]
): number {
  const validators = state.validators;
  let total = 0;
  for (const index of state.epochCtx.currentShuffling.activeIndices) {
    if (participation[index] && !validators.getReadonly(index).slashed) {
      total += getValidatorWeight(inactivityScores[index]);
    }
  }
  return checkedWeightSum(total);
}

/** Inactivity scores read once per block for the quorum checks of `process_height_events` */
export type QuorumContext = {
  inactivityScores: number[];
  totalWeight: number;
};

export function getQuorumContext(state: CachedBeaconStateEip8453): QuorumContext {
  const inactivityScores = state.inactivityScores.getAll();
  return {inactivityScores, totalWeight: getTotalActiveWeight(state, inactivityScores)};
}

// Spec: has_quorum
export function hasQuorum(state: CachedBeaconStateEip8453, participation: boolean[], ctx: QuorumContext): boolean {
  const participatingWeight = getParticipatingWeight(state, ctx.inactivityScores, participation);
  return participatingWeight > 0 && participatingWeight * 3 >= ctx.totalWeight * 2;
}

// Committees

/**
 * Spec: compute_balance_weighted_selection (gloas/beacon-chain.md), with the `shuffle_indices=True` path that
 * EIP8453 uses for the head vote committee and the PTC.
 */
export function computeBalanceWeightedSelection(
  effectiveBalanceIncrements: EffectiveBalanceIncrements,
  indices: Uint32Array,
  seed: Uint8Array,
  size: number,
  shuffleIndices: boolean
): Uint32Array {
  const total = indices.length;
  if (total === 0) {
    throw Error("Validator indices must not be empty");
  }

  const selected = new Uint32Array(size);
  let selectedLength = 0;
  let randomBytes: Uint8Array = new Uint8Array(32);
  let i = 0;
  while (selectedLength < size) {
    const offset = (i % 16) * 2;
    if (offset === 0) {
      randomBytes = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 16), 8, "le")]));
    }
    let nextIndex = i % total;
    if (shuffleIndices) {
      nextIndex = computeShuffledIndex(nextIndex, total, seed);
    }
    const candidate = indices[nextIndex];
    const weight = effectiveBalanceIncrements[candidate] * MAX_RANDOM_VALUE;
    const randomValue = randomBytes[offset] + randomBytes[offset + 1] * 256;
    const threshold = MAX_EFFECTIVE_BALANCE_INCREMENTS * randomValue;
    if (weight >= threshold) {
      selected[selectedLength++] = candidate;
    }
    i++;
  }
  return selected;
}

// Spec: compute_uniform_selection
export function computeUniformSelection(indices: Uint32Array, seed: Uint8Array, size: number): Uint32Array {
  const total = indices.length;
  if (total === 0) {
    throw Error("Validator indices must not be empty");
  }
  const selected = new Uint32Array(size);
  for (let i = 0; i < size; i++) {
    selected[i] = indices[computeShuffledIndex(i % total, total, seed)];
  }
  return selected;
}

/** `sha256(get_seed(state, epoch, domain_type) + uint_to_bytes(slot))` */
export function computeSlotSeed(
  state: CachedBeaconStateEip8453,
  epoch: Epoch,
  domainType: Uint8Array,
  slot: Slot
): Uint8Array {
  return digest(Buffer.concat([getSeed(state, epoch, domainType), intToBytes(slot, 8, "le")]));
}

// Spec: get_head_vote_committee
export function getHeadVoteCommittee(state: CachedBeaconStateEip8453, slot: Slot): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  return computeBalanceWeightedSelection(
    state.epochCtx.effectiveBalanceIncrements,
    getActiveIndicesAtEpoch(state, epoch),
    computeSlotSeed(state, epoch, DOMAIN_HEAD_VOTE_COMMITTEE, slot),
    HEAD_VOTE_COMMITTEE_SIZE,
    true
  );
}

// Spec: compute_ptc [Modified in EIP8453]
export function computePtcEip8453(
  state: CachedBeaconStateEip8453,
  slot: Slot,
  activeIndices: Uint32Array = getActiveIndicesAtEpoch(state, computeEpochAtSlot(slot))
): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  return computeBalanceWeightedSelection(
    state.epochCtx.effectiveBalanceIncrements,
    activeIndices,
    computeSlotSeed(state, epoch, DOMAIN_PTC_ATTESTER, slot),
    PTC_SIZE,
    true
  );
}

// Spec: get_inclusion_list_committee [Modified in EIP8453]
export function getInclusionListCommitteeEip8453(state: CachedBeaconStateEip8453, slot: Slot): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  return computeUniformSelection(
    getActiveIndicesAtEpoch(state, epoch),
    computeSlotSeed(state, epoch, DOMAIN_INCLUSION_LIST_COMMITTEE, slot),
    INCLUSION_LIST_COMMITTEE_SIZE
  );
}

// Rewards and inactivity

// Spec: get_finality_delay [Modified in EIP8453], measured in rounds and floored at zero
export function getFinalityDelayRounds(state: CachedBeaconStateEip8453): Round {
  const previousRound = getPreviousRound(state);
  const finalizedRound = computeRoundAtSlot(state.finalizedSlot);
  return finalizedRound > previousRound ? 0 : previousRound - finalizedRound;
}

// Spec: is_in_inactivity_leak [Modified in EIP8453]
export function isInInactivityLeakEip8453(state: CachedBeaconStateEip8453): boolean {
  return getFinalityDelayRounds(state) > MIN_ROUNDS_TO_INACTIVITY_LEAK;
}

/** `EFFECTIVE_BALANCE_INCREMENT * ROUND_REWARD_FACTOR // integer_squareroot(get_total_active_balance(state))` */
export function getRoundRewardPerIncrement(state: CachedBeaconStateEip8453): number {
  const totalActiveBalance = BigInt(state.epochCtx.totalActiveBalanceIncrements) * BigInt(EFFECTIVE_BALANCE_INCREMENT);
  return Math.floor((EFFECTIVE_BALANCE_INCREMENT * ROUND_REWARD_FACTOR) / bnToNum(bigIntSqrt(totalActiveBalance)));
}

// Spec: get_round_base_reward
export function getRoundBaseReward(
  state: CachedBeaconStateEip8453,
  index: ValidatorIndex,
  rewardPerIncrement = getRoundRewardPerIncrement(state)
): number {
  return state.epochCtx.effectiveBalanceIncrements[index] * rewardPerIncrement;
}

// Spec: get_unslashed_participating_indices [Modified in EIP8453], over `round_participation`
export function getUnslashedParticipatingIndicesEip8453(
  state: CachedBeaconStateEip8453,
  flagIndex: number,
  roundParticipation: number[] = state.roundParticipation.getAll()
): ValidatorIndex[] {
  const flag = 1 << flagIndex;
  const validators = state.validators;
  const indices: ValidatorIndex[] = [];
  for (const index of state.epochCtx.currentShuffling.activeIndices) {
    if ((roundParticipation[index] & flag) === flag && !validators.getReadonly(index).slashed) {
      indices.push(index);
    }
  }
  return indices;
}

/** Whether `validatorIndex` is active in the current epoch of `state` */
export function isActiveInCurrentEpoch(state: CachedBeaconStateEip8453, validatorIndex: ValidatorIndex): boolean {
  return isActiveValidator(state.validators.getReadonly(validatorIndex), state.epochCtx.epoch);
}

export function heightCheckpointToStr(checkpoint: {height: number | bigint; root: Root}): string {
  return `(${checkpoint.height}, 0x${Buffer.from(checkpoint.root).toString("hex").slice(0, 8)})`;
}
