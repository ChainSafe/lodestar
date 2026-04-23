import {
  BUILDER_INDEX_FLAG,
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  BUILDER_WITHDRAWAL_PREFIX,
  EFFECTIVE_BALANCE_INCREMENT,
  FAR_FUTURE_EPOCH,
  MIN_DEPOSIT_AMOUNT,
  MIN_SEED_LOOKAHEAD,
  PTC_SIZE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {BuilderIndex, Epoch, ValidatorIndex, gloas} from "@lodestar/types";
import {AttestationData} from "@lodestar/types/phase0";
import {byteArrayEquals} from "@lodestar/utils";
import {CachedBeaconStateFulu, CachedBeaconStateGloas} from "../types.js";
import {getBlockRootAtSlot} from "./blockRoot.js";
import {computeEpochAtSlot} from "./epoch.js";
import {computeEpochShuffling} from "./epochShuffling.js";
import {RootCache} from "./rootCache.js";
import {computePayloadTimelinessCommitteesForEpoch} from "./seed.js";
import {getActiveValidatorIndices} from "./validator.js";

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

// TODO GLOAS: This function no longer exists in v1.7.0-alpha.5 specs. Remove it when appropriate to do so
export function isParentBlockFull(state: CachedBeaconStateGloas): boolean {
  return byteArrayEquals(state.latestExecutionPayloadBid.blockHash, state.latestBlockHash);
}

export function initializePtcWindow(state: CachedBeaconStateFulu): Uint32Array[] {
  const ptcWindow: Uint32Array[] = Array.from({length: SLOTS_PER_EPOCH}, () => new Uint32Array(PTC_SIZE));
  const currentEpoch = state.epochCtx.epoch;

  for (let epochOffset = 0; epochOffset <= MIN_SEED_LOOKAHEAD; epochOffset++) {
    const epoch = currentEpoch + epochOffset;
    const shuffling =
      state.epochCtx.getShufflingAtEpochOrNull(epoch) ??
      computeEpochShuffling(state, getActiveValidatorIndices(state, epoch), epoch);

    ptcWindow.push(
      ...computePayloadTimelinessCommitteesForEpoch(
        state,
        epoch,
        shuffling.committees,
        state.epochCtx.effectiveBalanceIncrements
      )
    );
  }

  return ptcWindow;
}

export function getPtcWindowEpochCacheData(state: CachedBeaconStateGloas): {
  previousPayloadTimelinessCommittees: Uint32Array[];
  payloadTimelinessCommittees: Uint32Array[];
  nextPayloadTimelinessCommittees: Uint32Array[];
} {
  const toUint32Arrays = (views: ReturnType<typeof state.ptcWindow.getReadonlyByRange>) =>
    views.map((v) => Uint32Array.from(v.getAll()));

  const previousPtcWindow = state.ptcWindow.getReadonlyByRange(0, SLOTS_PER_EPOCH);
  const currentPtcWindow = state.ptcWindow.getReadonlyByRange(SLOTS_PER_EPOCH, SLOTS_PER_EPOCH);
  const nextPtcWindow = state.ptcWindow.getReadonlyByRange(2 * SLOTS_PER_EPOCH, SLOTS_PER_EPOCH);

  return {
    previousPayloadTimelinessCommittees: toUint32Arrays(previousPtcWindow),
    payloadTimelinessCommittees: toUint32Arrays(currentPtcWindow),
    nextPayloadTimelinessCommittees: toUint32Arrays(nextPtcWindow),
  };
}
