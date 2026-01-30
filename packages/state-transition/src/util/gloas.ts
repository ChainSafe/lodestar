import {byteArrayEquals} from "@chainsafe/ssz";
import {
  BUILDER_INDEX_FLAG,
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  BUILDER_WITHDRAWAL_PREFIX,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MIN_DEPOSIT_AMOUNT,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {BuilderIndex, ValidatorIndex} from "@lodestar/types";
import {AttestationData} from "@lodestar/types/phase0";
import {CachedBeaconStateGloas} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeEpochAtSlot} from "./epoch.js";
import {RootCache} from "./rootCache.js";

export function isBuilderWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === BUILDER_WITHDRAWAL_PREFIX;
}

export function getBuilderPaymentQuorumThreshold(state: CachedBeaconStateGloas): number {
  const quorum =
    Math.floor((state.epochCtx.totalActiveBalanceIncrements * EFFECTIVE_BALANCE_INCREMENT) / SLOTS_PER_EPOCH) *
    BUILDER_PAYMENT_THRESHOLD_NUMERATOR;

  return Math.floor(quorum / BUILDER_PAYMENT_THRESHOLD_DENOMINATOR);
}

/**
 * Check if a validator index represents a builder (has the builder flag set).
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-is_builder_index
 */
export function isBuilderIndex(validatorIndex: number): boolean {
  return (validatorIndex & BUILDER_INDEX_FLAG) !== 0;
}

/**
 * Convert a builder index to a flagged validator index for use in Withdrawal containers.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-convert_builder_index_to_validator_index
 */
export function convertBuilderIndexToValidatorIndex(builderIndex: BuilderIndex): ValidatorIndex {
  return builderIndex | BUILDER_INDEX_FLAG;
}

/**
 * Convert a flagged validator index back to a builder index.
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#new-convert_validator_index_to_builder_index
 */
export function convertValidatorIndexToBuilderIndex(validatorIndex: ValidatorIndex): BuilderIndex {
  return validatorIndex & ~BUILDER_INDEX_FLAG;
}

/**
 * Check if a builder is active (deposited and not yet withdrawable).
 * Spec: https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.1/specs/gloas/beacon-chain.md#isactivebuilder
 */
export function isActiveBuilder(state: CachedBeaconStateGloas, builderIndex: BuilderIndex): boolean {
  const builder = state.builders.getReadonly(builderIndex);
  const finalizedEpoch = state.finalizedCheckpoint.epoch;

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

export function isParentBlockFull(state: CachedBeaconStateGloas): boolean {
  return byteArrayEquals(state.latestExecutionPayloadBid.blockHash, state.latestBlockHash);
}
