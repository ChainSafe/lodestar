import {digest} from "@chainsafe/as-sha256";
import {
  BUILDER_INDEX_FLAG,
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  BUILDER_WITHDRAWAL_PREFIX,
  DOMAIN_PTC_ATTESTER,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MAX_EFFECTIVE_BALANCE_ELECTRA,
  MIN_DEPOSIT_AMOUNT,
  MIN_SEED_LOOKAHEAD,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {BuilderIndex, Epoch, Slot, ValidatorIndex, gloas} from "@lodestar/types";
import {AttestationData} from "@lodestar/types/phase0";
import {byteArrayEquals, bytesToInt, intToBytes} from "@lodestar/utils";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "./epoch.js";
import {type EpochShuffling, computeEpochShuffling} from "./epochShuffling.js";
import {RootCache} from "./rootCache.js";
import {computeShuffledIndex, getSeed} from "./seed.js";
import {getActiveValidatorIndices} from "./validator.js";

const MAX_BALANCE_WEIGHTED_RANDOM_VALUE = 2 ** 16 - 1;

type PtcState = CachedBeaconStateFulu | CachedBeaconStateGloas;

export function isBuilderWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === BUILDER_WITHDRAWAL_PREFIX;
}

export function getBuilderPaymentQuorumThreshold(state: CachedBeaconStateGloas): number {
  const quorum =
    Math.floor((state.epochCtx.totalActiveBalanceIncrements * EFFECTIVE_BALANCE_INCREMENT) / SLOTS_PER_EPOCH) *
    BUILDER_PAYMENT_THRESHOLD_NUMERATOR;

  return Math.floor(quorum / BUILDER_PAYMENT_THRESHOLD_DENOMINATOR);
}

function hasBuilderIndexFlag(index: number): boolean {
  // Equivalent to `(index & BUILDER_INDEX_FLAG) != 0`
  return Math.floor(index / BUILDER_INDEX_FLAG) % 2 === 1;
}

/**
 * Check if a validator index represents a builder (has the builder flag set).
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-is_builder_index
 */
export function isBuilderIndex(validatorIndex: number): boolean {
  // Note: Can't use bitwise AND (&) because BUILDER_INDEX_FLAG exceeds 32 bits in JS bitwise operations.
  return hasBuilderIndexFlag(validatorIndex);
}

/**
 * Convert a builder index to a flagged validator index for use in Withdrawal containers.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-convert_builder_index_to_validator_index
 */
export function convertBuilderIndexToValidatorIndex(builderIndex: BuilderIndex): ValidatorIndex {
  // Note: Can't use bitwise OR (|) because BUILDER_INDEX_FLAG exceeds 32 bits in JS bitwise operations.
  return hasBuilderIndexFlag(builderIndex) ? builderIndex : builderIndex + BUILDER_INDEX_FLAG;
}

/**
 * Convert a flagged validator index back to a builder index.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-convert_validator_index_to_builder_index
 */
export function convertValidatorIndexToBuilderIndex(validatorIndex: ValidatorIndex): BuilderIndex {
  // Note: Can't use bitwise AND (&) because BUILDER_INDEX_FLAG exceeds 32 bits in JS bitwise operations.
  return hasBuilderIndexFlag(validatorIndex) ? validatorIndex - BUILDER_INDEX_FLAG : validatorIndex;
}

/**
 * Check if a builder is active (deposited and not yet withdrawable).
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#isactivebuilder
 */
export function isActiveBuilder(builder: gloas.Builder, finalizedEpoch: Epoch): boolean {
  return builder.depositEpoch < finalizedEpoch && builder.withdrawableEpoch === FAR_FUTURE_EPOCH;
}

/**
 * Get the total pending balance to withdraw for a builder (from withdrawals + payments).
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-get_pending_balance_to_withdraw_for_builder
 */
export function getPendingBalanceToWithdrawForBuilder(
  state: CachedBeaconStateGloas,
  builderIndex: BuilderIndex
): number {
  let pendingBalance = 0;

  // Sum pending withdrawals
  for (let i = 0; i < state.builderPendingWithdrawals.length; i++) {
    const withdrawal = state.builderPendingWithdrawals.getReadonly(i);
    if (withdrawal.builderIndex === builderIndex) {
      pendingBalance += withdrawal.amount;
    }
  }

  // Sum pending payments
  for (let i = 0; i < state.builderPendingPayments.length; i++) {
    const payment = state.builderPendingPayments.getReadonly(i);
    if (payment.withdrawal.builderIndex === builderIndex) {
      pendingBalance += payment.withdrawal.amount;
    }
  }

  return pendingBalance;
}

/**
 * Check if a builder has sufficient balance to cover a bid amount.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-can_builder_cover_bid
 */
export function canBuilderCoverBid(
  state: CachedBeaconStateGloas,
  builderIndex: BuilderIndex,
  bidAmount: number
): boolean {
  const builder = state.builders.getReadonly(builderIndex);
  const pendingBalance = getPendingBalanceToWithdrawForBuilder(state, builderIndex);
  const minBalance = MIN_DEPOSIT_AMOUNT + pendingBalance;

  if (builder.balance < minBalance) {
    return false;
  }

  return builder.balance - minBalance >= bidAmount;
}

/**
 * Initiate a builder exit by setting their withdrawable epoch.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-initiate_builder_exit
 */
export function initiateBuilderExit(state: CachedBeaconStateGloas, builderIndex: BuilderIndex): void {
  const builder = state.builders.get(builderIndex);

  // Return if builder already initiated exit
  if (builder.withdrawableEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // Set builder exit epoch
  const currentEpoch = computeEpochAtSlot(state.slot);
  builder.withdrawableEpoch = currentEpoch + state.config.MIN_BUILDER_WITHDRAWABILITY_DELAY;
}

/**
 * Find the index of a builder by their public key.
 * Returns null if not found.
 *
 * May consider builder pubkey cache if performance becomes an issue.
 */
export function findBuilderIndexByPubkey(state: CachedBeaconStateGloas, pubkey: Uint8Array): BuilderIndex | null {
  for (let i = 0; i < state.builders.length; i++) {
    if (byteArrayEquals(state.builders.getReadonly(i).pubkey, pubkey)) {
      return i;
    }
  }
  return null;
}

export function isAttestationSameSlot(state: CachedBeaconStateGloas, data: AttestationData): boolean {
  if (data.slot === 0) return true;

  const isMatchingBlockRoot = byteArrayEquals(data.beaconBlockRoot, getBlockRootAtSlot(state, data.slot));
  const isCurrentBlockRoot = !byteArrayEquals(data.beaconBlockRoot, getBlockRootAtSlot(state, data.slot - 1));

  return isMatchingBlockRoot && isCurrentBlockRoot;
}

export function isAttestationSameSlotRootCache(rootCache: RootCache, data: AttestationData): boolean {
  if (data.slot === 0) return true;

  const isMatchingBlockRoot = byteArrayEquals(data.beaconBlockRoot, rootCache.getBlockRootAtSlot(data.slot));
  const isCurrentBlockRoot = !byteArrayEquals(data.beaconBlockRoot, rootCache.getBlockRootAtSlot(data.slot - 1));

  return isMatchingBlockRoot && isCurrentBlockRoot;
}

export function computeBalanceWeightedAcceptance(effectiveBalance: number, seed: Uint8Array, i: number): boolean {
  const randomBytes = digest(Buffer.concat([seed, intToBytes(Math.floor(i / 16), 8)]));
  const offset = (i % 16) * 2;
  const randomValue = bytesToInt(randomBytes.subarray(offset, offset + 2));

  return isBalanceWeightedAcceptance(effectiveBalance, randomValue);
}

export function computeBalanceWeightedSelection(
  state: PtcState,
  indices: ArrayLike<ValidatorIndex>,
  seed: Uint8Array,
  size: number,
  shuffleIndices: boolean
): Uint32Array {
  const total = indices.length;
  if (total === 0) {
    throw Error("Validator indices must not be empty");
  }

  const effectiveBalances = new Array<number>(total);
  for (let i = 0; i < total; i++) {
    effectiveBalances[i] = state.validators.getReadonly(indices[i]).effectiveBalance;
  }

  const selected = new Uint32Array(size);
  let selectedLen = 0;
  let i = 0;
  let randomBytes = digest(Buffer.concat([seed, intToBytes(0, 8)]));
  let lastBlock = 0;

  while (selectedLen < size) {
    let nextIndex = i % total;
    if (shuffleIndices) {
      nextIndex = computeShuffledIndex(nextIndex, total, seed);
    }

    const block = Math.floor(i / 16);
    if (block !== lastBlock) {
      randomBytes = digest(Buffer.concat([seed, intToBytes(block, 8)]));
      lastBlock = block;
    }

    const offset = (i % 16) * 2;
    const randomValue = bytesToInt(randomBytes.subarray(offset, offset + 2));
    if (isBalanceWeightedAcceptance(effectiveBalances[nextIndex], randomValue)) {
      selected[selectedLen++] = indices[nextIndex];
    }

    i += 1;
  }

  return selected;
}

export function computePtc(state: PtcState, slot: Slot, shuffling?: EpochShuffling): Uint32Array {
  const epoch = computeEpochAtSlot(slot);
  const slotSeed = digest(Buffer.concat([getSeed(state, epoch, DOMAIN_PTC_ATTESTER), intToBytes(slot, 8)]));
  const epochShuffling =
    shuffling ??
    state.epochCtx.getShufflingAtEpochOrNull(epoch) ??
    computeEpochShuffling(state, getActiveValidatorIndices(state, epoch), epoch);
  const slotCommittees = epochShuffling.committees[slot % SLOTS_PER_EPOCH];
  const totalIndices = slotCommittees.reduce((sum, committee) => sum + committee.length, 0);
  const indices = new Uint32Array(totalIndices);
  let offset = 0;

  for (const committee of slotCommittees) {
    indices.set(committee, offset);
    offset += committee.length;
  }

  return computeBalanceWeightedSelection(state, indices, slotSeed, PTC_SIZE, false);
}

export function initializePtcWindow(state: PtcState): ValidatorIndex[][] {
  const emptyCommittee = Array.from({length: PTC_SIZE}, () => 0);
  const emptyPreviousEpoch = Array.from({length: SLOTS_PER_EPOCH}, () => [...emptyCommittee]);
  const ptcWindow: ValidatorIndex[][] = [];
  const currentEpoch = computeEpochAtSlot(state.slot);

  for (let epochOffset = 0; epochOffset <= MIN_SEED_LOOKAHEAD; epochOffset++) {
    const epoch = currentEpoch + epochOffset;
    const startSlot = computeStartSlotAtEpoch(epoch);
    const shuffling =
      state.epochCtx.getShufflingAtEpochOrNull(epoch) ??
      computeEpochShuffling(state, getActiveValidatorIndices(state, epoch), epoch);

    for (let slotOffset = 0; slotOffset < SLOTS_PER_EPOCH; slotOffset++) {
      ptcWindow.push(Array.from(computePtc(state, startSlot + slotOffset, shuffling)));
    }
  }

  return [...emptyPreviousEpoch, ...ptcWindow];
}

export function isParentBlockFull(state: CachedBeaconStateGloas): boolean {
  return byteArrayEquals(state.latestExecutionPayloadBid.blockHash, state.latestBlockHash);
}

function isBalanceWeightedAcceptance(effectiveBalance: number, randomValue: number): boolean {
  return effectiveBalance * MAX_BALANCE_WEIGHTED_RANDOM_VALUE >= MAX_EFFECTIVE_BALANCE_ELECTRA * randomValue;
}
