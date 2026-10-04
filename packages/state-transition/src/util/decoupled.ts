import {digest} from "@chainsafe/as-sha256";
import {
  AVAILABLE_CHAIN_COMMITTEE_SIZE,
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  COMMITTEES_PER_ROUND,
  DOMAIN_AVAILABLE_CHAIN_ATTESTER,
  DOMAIN_BEACON_ATTESTER_2,
  DOMAIN_PTC_ATTESTER,
  EFFECTIVE_BALANCE_INCREMENT,
  EMPTY_HEIGHT,
  FINALITY_FLAG_INDEX,
  GENESIS_SLOT,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MAX_VALIDATORS_PER_AGGREGATE,
  MIN_ATTESTATION_INCLUSION_DELAY,
  PAYLOAD_STATUS_EMPTY,
  PAYLOAD_STATUS_FULL,
  PROGRESS_FLAG_INDEX,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
  SLOTS_PER_ROUND,
  TARGET_FLAG_INDEX,
} from "@lodestar/params";
import {Epoch, Slot, ValidatorIndex, decoupled, ssz} from "@lodestar/types";
import {byteArrayEquals, intToBytes, toRootHex} from "@lodestar/utils";
import {EffectiveBalanceIncrements} from "../cache/effectiveBalanceIncrements.js";
import {ZERO_HASH} from "../constants/index.js";
import {CachedBeaconStateDecoupled} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";
import {computeShuffledIndex, getSeed} from "./seed.js";
import {createAggregateSignatureSetFromComponents, verifySignatureSet} from "./signatureSets.js";
import {computeSigningRoot} from "./signingRoot.js";
import {getActiveValidatorIndices, isActiveValidator} from "./validator.js";

export type Round = number;

export const FINALITY_FLAG = 1 << FINALITY_FLAG_INDEX;
export const TARGET_FLAG = 1 << TARGET_FLAG_INDEX;
export const PROGRESS_FLAG = 1 << PROGRESS_FLAG_INDEX;

const MAX_RANDOM_VALUE = 2 ** 16 - 1;
const MAX_EFFECTIVE_BALANCE_INCREMENTS = MAX_EFFECTIVE_BALANCE_ELECTRA / EFFECTIVE_BALANCE_INCREMENT;

export function isZeroRoot(root: Uint8Array): boolean {
  return byteArrayEquals(root, ZERO_HASH);
}

export function heightPairEquals(a: decoupled.HeightPair, b: decoupled.HeightPair): boolean {
  return a.height === b.height && byteArrayEquals(a.root, b.root);
}

// Spec: compute_round_at_slot (decoupled-consensus/beacon-chain.md)
export function computeRoundAtSlot(slot: Slot): Round {
  return Math.floor(slot / SLOTS_PER_ROUND);
}

// Spec: compute_start_slot_at_round (decoupled-consensus/beacon-chain.md)
export function computeStartSlotAtRound(round: Round): Slot {
  return round * SLOTS_PER_ROUND;
}

// Spec: compute_epoch_at_round (decoupled-consensus/beacon-chain.md)
export function computeEpochAtRound(round: Round): Epoch {
  return computeEpochAtSlot(computeStartSlotAtRound(round));
}

// Spec: remove_flag (decoupled-consensus/beacon-chain.md)
export function removeFlag(flags: number, flagIndex: number): number {
  return flags & ~(1 << flagIndex);
}

// Spec: has_quorum (decoupled-consensus/beacon-chain.md)
export function hasQuorum(state: CachedBeaconStateDecoupled, flagIndex: number): boolean {
  const {epochCtx} = state;
  const epoch = epochCtx.epoch;
  const flag = 1 << flagIndex;
  const participation = state.heightParticipation.getAll();
  const validators = state.validators;

  let supportIncrements = 0;
  for (let index = 0; index < participation.length; index++) {
    if ((participation[index] & flag) === 0) {
      continue;
    }
    const validator = validators.getReadonly(index);
    if (validator.slashed || !isActiveValidator(validator, epoch)) {
      continue;
    }
    supportIncrements += epochCtx.effectiveBalanceIncrements[index];
  }

  // get_total_balance and get_total_active_balance both floor at EFFECTIVE_BALANCE_INCREMENT
  const support = Math.max(1, supportIncrements);
  const totalActive = Math.max(1, epochCtx.totalActiveBalanceIncrements);
  return support * 3 >= totalActive * 2;
}

// Spec: is_slashable_attestation_data_2 (decoupled-consensus/beacon-chain.md)
export function isSlashableAttestationData2(
  data1: decoupled.AttestationData2,
  data2: decoupled.AttestationData2
): boolean {
  const isTargetConflictingWithFinality = (finality: decoupled.HeightPair, target: decoupled.HeightPair): boolean =>
    !isZeroRoot(finality.root) && finality.height === target.height && !byteArrayEquals(finality.root, target.root);

  if (
    isTargetConflictingWithFinality(data1.finalizePair, data2.targetPair) ||
    isTargetConflictingWithFinality(data2.finalizePair, data1.targetPair)
  ) {
    return true;
  }

  return (
    !isZeroRoot(data1.targetPair.root) &&
    !isZeroRoot(data2.targetPair.root) &&
    data1.targetPair.height === data2.targetPair.height &&
    !byteArrayEquals(data1.targetPair.root, data2.targetPair.root)
  );
}

const MAX_CACHED_COMMITTEE_INDICES = 8;
const committeeEligibleIndicesCache = new Map<string, Uint32Array>();

/**
 * Validators that are not exited at the finalized epoch, the candidate pool of the round rotation.
 *
 * Membership only changes when the registry grows or the finalized epoch moves, because exit epochs
 * are only ever set to values above the current finalized epoch. The validators root in the key keeps
 * states from unrelated chains apart.
 */
export function getCommitteeEligibleIndices(state: CachedBeaconStateDecoupled): Uint32Array {
  const finalizedEpoch = computeEpochAtSlot(state.finalizedSlot);
  const key = `${finalizedEpoch}:${state.validators.length}:${toRootHex(state.validators.hashTreeRoot())}`;
  const cached = committeeEligibleIndicesCache.get(key);
  if (cached) {
    return cached;
  }

  const validators = state.validators.getAllReadonlyValues();
  const indices: number[] = [];
  for (let index = 0; index < validators.length; index++) {
    if (validators[index].exitEpoch > finalizedEpoch) {
      indices.push(index);
    }
  }
  const result = new Uint32Array(indices);

  if (committeeEligibleIndicesCache.size >= MAX_CACHED_COMMITTEE_INDICES) {
    const oldest = committeeEligibleIndicesCache.keys().next().value;
    if (oldest !== undefined) committeeEligibleIndicesCache.delete(oldest);
  }
  committeeEligibleIndicesCache.set(key, result);
  return result;
}

// Spec: get_beacon_committee [Modified in DC] (decoupled-consensus/beacon-chain.md)
export function getBeaconCommitteeDecoupled(
  state: CachedBeaconStateDecoupled,
  round: Round,
  committeeIndex: number
): ValidatorIndex[] {
  const indices = getCommitteeEligibleIndices(state);
  const count = indices.length;
  if (count === 0) {
    throw Error("No validators eligible for decoupled committees");
  }
  const start = Math.floor((count * committeeIndex) / COMMITTEES_PER_ROUND);
  const end = Math.floor((count * (committeeIndex + 1)) / COMMITTEES_PER_ROUND);
  const committee = new Array<ValidatorIndex>(end - start);
  for (let i = start; i < end; i++) {
    committee[i - start] = indices[(i + round) % count];
  }
  return committee;
}

// Spec: get_attesting_indices [Modified in DC] (decoupled-consensus/beacon-chain.md)
export function getAttestingIndicesDecoupled(
  state: CachedBeaconStateDecoupled,
  attestation: decoupled.Attestation
): ValidatorIndex[] {
  const {aggregationBits, committeeBits, data} = attestation;
  const output: ValidatorIndex[] = [];
  let committeeOffset = 0;
  for (const committeeIndex of committeeBits.getTrueBitIndexes()) {
    const committee = getBeaconCommitteeDecoupled(state, data.round, committeeIndex);
    // The pyspec raises IndexError on a short bitlist, which makes the block invalid
    if (aggregationBits.bitLen < committeeOffset + committee.length) {
      throw Error(
        `Aggregation bits too short: bitLen=${aggregationBits.bitLen} needed=${committeeOffset + committee.length}`
      );
    }
    for (let i = 0; i < committee.length; i++) {
      if (aggregationBits.get(committeeOffset + i)) {
        output.push(committee[i]);
      }
    }
    committeeOffset += committee.length;
  }
  return output;
}

// Spec: is_valid_aggregation_bits (decoupled-consensus/beacon-chain.md)
export function isValidAggregationBits(state: CachedBeaconStateDecoupled, attestation: decoupled.Attestation): boolean {
  const {aggregationBits, committeeBits, data} = attestation;
  const currentEpoch = state.epochCtx.epoch;
  let committeeOffset = 0;
  for (const committeeIndex of committeeBits.getTrueBitIndexes()) {
    const committee = getBeaconCommitteeDecoupled(state, data.round, committeeIndex);
    if (aggregationBits.bitLen < committeeOffset + committee.length) {
      return false;
    }
    let attesters = 0;
    for (let i = 0; i < committee.length; i++) {
      if (!aggregationBits.get(committeeOffset + i)) {
        continue;
      }
      attesters++;
      if (!isActiveValidator(state.validators.getReadonly(committee[i]), currentEpoch)) {
        return false;
      }
    }
    if (attesters === 0) {
      return false;
    }
    committeeOffset += committee.length;
  }
  return true;
}

// Spec: is_valid_attestation_data (decoupled-consensus/beacon-chain.md)
export function isValidAttestationData(state: CachedBeaconStateDecoupled, data: decoupled.AttestationData2): boolean {
  const currentRound = computeRoundAtSlot(state.slot);
  if (data.round + 1 !== currentRound && data.round !== currentRound) {
    return false;
  }

  const emptyPair = {height: EMPTY_HEIGHT, root: ZERO_HASH};
  if (heightPairEquals(data.targetPair, emptyPair) && heightPairEquals(data.finalizePair, emptyPair)) {
    return false;
  }

  const statePairs = {
    target: state.targetPair.toValue(),
    justified: state.justifiedPair.toValue(),
    finalized: state.finalizedPair.toValue(),
  };

  const isValidTargetRoot =
    isZeroRoot(data.targetPair.root) ||
    byteArrayEquals(data.targetPair.root, statePairs.target.root) ||
    byteArrayEquals(data.targetPair.root, statePairs.justified.root);
  const isValidTargetHeight =
    data.targetPair.height === EMPTY_HEIGHT ||
    data.targetPair.height === statePairs.target.height ||
    data.targetPair.height === statePairs.justified.height;
  const isValidFinalizeRoot =
    isZeroRoot(data.finalizePair.root) ||
    byteArrayEquals(data.finalizePair.root, statePairs.justified.root) ||
    byteArrayEquals(data.finalizePair.root, statePairs.finalized.root);
  const isValidFinalizeHeight =
    data.finalizePair.height === EMPTY_HEIGHT ||
    data.finalizePair.height === statePairs.justified.height ||
    data.finalizePair.height === statePairs.finalized.height;

  return isValidTargetRoot && isValidTargetHeight && isValidFinalizeRoot && isValidFinalizeHeight;
}

/**
 * Returns the flags as a bitmask rather than the spec's list of indices.
 * Spec: get_height_participation_flag_indices (decoupled-consensus/beacon-chain.md)
 */
export function getHeightParticipationFlags(
  data: decoupled.AttestationData2,
  targetPair: decoupled.HeightPair,
  justifiedPair: decoupled.HeightPair
): number {
  const hasFinalitySupport = heightPairEquals(data.finalizePair, justifiedPair);
  const hasTargetSupport = heightPairEquals(data.targetPair, targetPair);
  const hasProgressSupport = data.targetPair.height === targetPair.height && isZeroRoot(data.targetPair.root);

  let flags = 0;
  if (hasFinalitySupport) flags |= FINALITY_FLAG;
  if (hasTargetSupport) flags |= TARGET_FLAG;
  if (hasTargetSupport || hasProgressSupport) flags |= PROGRESS_FLAG;
  return flags;
}

// Spec: get_indexed_attestation_2 (decoupled-consensus/beacon-chain.md)
export function getIndexedAttestation2(
  state: CachedBeaconStateDecoupled,
  attestation: decoupled.Attestation
): decoupled.IndexedAttestation2 {
  const attestingIndices = getAttestingIndicesDecoupled(state, attestation);
  attestingIndices.sort((a, b) => a - b);
  return {attestingIndices, data: attestation.data, signature: attestation.signature};
}

export function getAttestationData2SigningRoot(
  state: CachedBeaconStateDecoupled,
  data: decoupled.AttestationData2
): Uint8Array {
  const messageSlot = computeStartSlotAtEpoch(computeEpochAtRound(data.round));
  const domain = state.config.getDomain(state.slot, DOMAIN_BEACON_ATTESTER_2, messageSlot);
  return computeSigningRoot(ssz.decoupled.AttestationData2, data, domain);
}

// Spec: is_valid_indexed_attestation_2 (decoupled-consensus/beacon-chain.md)
export function isValidIndexedAttestation2(
  state: CachedBeaconStateDecoupled,
  indexedAttestation: decoupled.IndexedAttestation2,
  verifySignature: boolean
): boolean {
  const indices = indexedAttestation.attestingIndices;
  if (indices.length === 0 || indices.length > MAX_VALIDATORS_PER_AGGREGATE) {
    return false;
  }
  let prev = -1;
  for (const index of indices) {
    if (index <= prev) return false;
    prev = index;
  }
  // The pyspec raises on an out-of-range validator lookup, which makes the block invalid
  if (prev >= state.validators.length) {
    return false;
  }

  if (!verifySignature) {
    return true;
  }
  return verifySignatureSet(
    createAggregateSignatureSetFromComponents(
      indices,
      getAttestationData2SigningRoot(state, indexedAttestation.data),
      indexedAttestation.signature
    )
  );
}

// Spec: compute_balance_weighted_selection (gloas/beacon-chain.md), the shuffle_indices=True path used by DC
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

function getActiveIndicesAtEpoch(state: CachedBeaconStateDecoupled, epoch: Epoch): Uint32Array {
  const {epochCtx} = state;
  if (epoch === epochCtx.epoch) return epochCtx.currentShuffling.activeIndices;
  if (epoch === epochCtx.previousShuffling.epoch) return epochCtx.previousShuffling.activeIndices;
  if (epoch === epochCtx.nextShuffling.epoch) return epochCtx.nextShuffling.activeIndices;
  return getActiveValidatorIndices(state, epoch);
}

function slotSeed(state: CachedBeaconStateDecoupled, epoch: Epoch, domainType: Uint8Array, slot: Slot): Uint8Array {
  return digest(Buffer.concat([getSeed(state, epoch, domainType), intToBytes(slot, 8, "le")]));
}

// Spec: compute_ptc [Modified in DC] (decoupled-consensus/beacon-chain.md)
export function computePtcDecoupled(state: CachedBeaconStateDecoupled, slot: Slot): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  return computeBalanceWeightedSelection(
    state.epochCtx.effectiveBalanceIncrements,
    getActiveIndicesAtEpoch(state, epoch),
    slotSeed(state, epoch, DOMAIN_PTC_ATTESTER, slot),
    PTC_SIZE,
    true
  );
}

export function computePtcForEpochDecoupled(
  state: CachedBeaconStateDecoupled,
  epoch: Epoch,
  activeIndices: Uint32Array = getActiveIndicesAtEpoch(state, epoch)
): Uint32Array[] {
  const startSlot = computeStartSlotAtEpoch(epoch);
  return Array.from({length: SLOTS_PER_EPOCH}, (_, i) =>
    computeBalanceWeightedSelection(
      state.epochCtx.effectiveBalanceIncrements,
      activeIndices,
      slotSeed(state, epoch, DOMAIN_PTC_ATTESTER, startSlot + i),
      PTC_SIZE,
      true
    )
  );
}

const MAX_CACHED_AVAILABLE_CHAIN_COMMITTEES = 2 * SLOTS_PER_EPOCH;
const availableChainCommitteeCache = new Map<string, Set<ValidatorIndex>>();

// Spec: compute_available_chain_committee (decoupled-consensus/beacon-chain.md)
export function computeAvailableChainCommittee(state: CachedBeaconStateDecoupled, slot: Slot): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  return computeBalanceWeightedSelection(
    state.epochCtx.effectiveBalanceIncrements,
    getActiveIndicesAtEpoch(state, epoch),
    slotSeed(state, epoch, DOMAIN_AVAILABLE_CHAIN_ATTESTER, slot),
    AVAILABLE_CHAIN_COMMITTEE_SIZE,
    true
  );
}

function getAvailableChainCommitteeSet(state: CachedBeaconStateDecoupled, slot: Slot): Set<ValidatorIndex> {
  const epoch = computeEpochAtSlot(slot);
  const seed = slotSeed(state, epoch, DOMAIN_AVAILABLE_CHAIN_ATTESTER, slot);
  const key = `${toRootHex(seed)}:${state.validators.length}`;
  const cached = availableChainCommitteeCache.get(key);
  if (cached) {
    return cached;
  }
  const committee = new Set(
    computeBalanceWeightedSelection(
      state.epochCtx.effectiveBalanceIncrements,
      getActiveIndicesAtEpoch(state, epoch),
      seed,
      AVAILABLE_CHAIN_COMMITTEE_SIZE,
      true
    )
  );
  if (availableChainCommitteeCache.size >= MAX_CACHED_AVAILABLE_CHAIN_COMMITTEES) {
    const oldest = availableChainCommitteeCache.keys().next().value;
    if (oldest !== undefined) availableChainCommitteeCache.delete(oldest);
  }
  availableChainCommitteeCache.set(key, committee);
  return committee;
}

// Spec: is_eligible_available_chain_attester (decoupled-consensus/beacon-chain.md)
export function isEligibleAvailableChainAttester(
  state: CachedBeaconStateDecoupled,
  slot: Slot,
  index: ValidatorIndex
): boolean {
  return getAvailableChainCommitteeSet(state, slot).has(index);
}

// Spec: is_available_chain_attestation_same_slot (decoupled-consensus/beacon-chain.md)
export function isAvailableChainAttestationSameSlot(
  state: CachedBeaconStateDecoupled,
  data: decoupled.AvailableChainAttestationData
): boolean {
  if (data.slot === GENESIS_SLOT) {
    return true;
  }
  const slotBlockRoot = getBlockRootAtSlot(state, data.slot);
  const prevBlockRoot = getBlockRootAtSlot(state, data.slot - 1);
  return byteArrayEquals(data.root, slotBlockRoot) && !byteArrayEquals(data.root, prevBlockRoot);
}

// Spec: is_valid_available_chain_attestation_data (decoupled-consensus/beacon-chain.md)
export function isValidAvailableChainAttestationData(
  state: CachedBeaconStateDecoupled,
  data: decoupled.AvailableChainAttestationData
): boolean {
  const epoch = computeEpochAtSlot(data.slot);
  if (data.slot + MIN_ATTESTATION_INCLUSION_DELAY > state.slot) {
    return false;
  }
  const currentEpoch = state.epochCtx.epoch;
  const previousEpoch = state.epochCtx.previousShuffling.epoch;
  if (epoch !== previousEpoch && epoch !== currentEpoch) {
    return false;
  }

  if (isAvailableChainAttestationSameSlot(state, data)) {
    return data.payloadStatus === PAYLOAD_STATUS_EMPTY;
  }
  return data.payloadStatus === PAYLOAD_STATUS_EMPTY || data.payloadStatus === PAYLOAD_STATUS_FULL;
}

// Spec: is_valid_available_chain_attestation (decoupled-consensus/beacon-chain.md)
export function isValidAvailableChainAttestation(
  state: CachedBeaconStateDecoupled,
  attestation: decoupled.AvailableChainAttestation,
  verifySignature: boolean
): boolean {
  const {data} = attestation;
  const indices = attestation.attestingIndices;
  if (indices.length === 0) {
    return false;
  }
  let prev = -1;
  for (const index of indices) {
    if (index <= prev) return false;
    prev = index;
  }
  if (prev >= state.validators.length) {
    return false;
  }

  if (!isValidAvailableChainAttestationData(state, data)) {
    return false;
  }

  for (const index of indices) {
    if (!isEligibleAvailableChainAttester(state, data.slot, index)) {
      return false;
    }
  }

  if (!verifySignature) {
    return true;
  }
  const domain = state.config.getDomain(state.slot, DOMAIN_AVAILABLE_CHAIN_ATTESTER, data.slot);
  const signingRoot = computeSigningRoot(ssz.decoupled.AvailableChainAttestationData, data, domain);
  return verifySignatureSet(createAggregateSignatureSetFromComponents(indices, signingRoot, attestation.signature));
}

// Spec: is_matching_head_attestation (decoupled-consensus/beacon-chain.md)
export function isMatchingHeadAttestation(
  state: CachedBeaconStateDecoupled,
  data: decoupled.AvailableChainAttestationData,
  parentSlot: Slot
): boolean {
  const headRootMatches = byteArrayEquals(data.root, getBlockRootAtSlot(state, data.slot));
  if (isAvailableChainAttestationSameSlot(state, data)) {
    return headRootMatches;
  }
  const payloadIndex = state.executionPayloadAvailability.get(parentSlot % SLOTS_PER_HISTORICAL_ROOT) ? 1 : 0;
  return headRootMatches && data.payloadStatus === payloadIndex;
}

// Spec: update_builder_payment_participation (decoupled-consensus/beacon-chain.md)
export function updateBuilderPaymentParticipation(
  state: CachedBeaconStateDecoupled,
  attestation: decoupled.AvailableChainAttestation
): void {
  const {data} = attestation;
  const epoch = computeEpochAtSlot(data.slot);
  const paymentIndex =
    epoch === state.epochCtx.epoch ? SLOTS_PER_EPOCH + (data.slot % SLOTS_PER_EPOCH) : data.slot % SLOTS_PER_EPOCH;
  // The spec re-evaluates the same-slot check per index, but it does not depend on the index
  if (!isAvailableChainAttestationSameSlot(state, data)) {
    return;
  }
  const participation = state.builderPaymentParticipation.get(paymentIndex);
  const existing = new Set(participation.getAll());
  for (const index of attestation.attestingIndices) {
    if (!existing.has(index)) {
      participation.push(index);
      existing.add(index);
    }
  }
}

// Spec: get_builder_payment_quorum_threshold [Modified in DC] (decoupled-consensus/beacon-chain.md)
export function getBuilderPaymentQuorumThresholdDecoupled(perSlotBalance: bigint): bigint {
  return (perSlotBalance * BigInt(BUILDER_PAYMENT_THRESHOLD_NUMERATOR)) / BigInt(BUILDER_PAYMENT_THRESHOLD_DENOMINATOR);
}
