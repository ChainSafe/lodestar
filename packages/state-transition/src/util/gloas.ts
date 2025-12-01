import {byteArrayEquals} from "@chainsafe/ssz";
import {
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  BUILDER_WITHDRAWAL_PREFIX,
  EFFECTIVE_BALANCE_INCREMENT,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {gloas} from "@lodestar/types";
import {AttestationData} from "@lodestar/types/phase0";
import {CachedBeaconStateGloas} from "../types.ts";
import {getBlockRootAtSlot} from "./blockRoot.ts";
import {computeEpochAtSlot} from "./epoch.ts";
import {RootCache} from "./rootCache.ts";

export function hasBuilderWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === BUILDER_WITHDRAWAL_PREFIX;
}

export function getBuilderPaymentQuorumThreshold(state: CachedBeaconStateGloas): number {
  const quorum =
    Math.floor((state.epochCtx.totalActiveBalanceIncrements * EFFECTIVE_BALANCE_INCREMENT) / SLOTS_PER_EPOCH) *
    BUILDER_PAYMENT_THRESHOLD_NUMERATOR;

  return Math.floor(quorum / BUILDER_PAYMENT_THRESHOLD_DENOMINATOR);
}

export function isBuilderPaymentWithdrawable(
  state: CachedBeaconStateGloas,
  withdrawal: gloas.BuilderPendingWithdrawal
): boolean {
  const builder = state.validators.getReadonly(withdrawal.builderIndex);
  const currentEpoch = computeEpochAtSlot(state.slot);

  return builder.withdrawableEpoch >= currentEpoch || !builder.slashed;
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
