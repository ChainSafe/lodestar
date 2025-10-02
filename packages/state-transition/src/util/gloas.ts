import {
  BUILDER_PAYMENT_THRESHOLD_DENOMINATOR,
  BUILDER_PAYMENT_THRESHOLD_NUMERATOR,
  BUILDER_WITHDRAWAL_PREFIX,
  EFFECTIVE_BALANCE_INCREMENT,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {CachedBeaconStateGloas} from "../types.ts";

export function hasBuilderWithdrawalCredential(withdrawalCredentials: Uint8Array): boolean {
  return withdrawalCredentials[0] === BUILDER_WITHDRAWAL_PREFIX;
}

export function getBuilderPaymentQuorumThreshold(state: CachedBeaconStateGloas): number {
  const quorum =
    Math.floor(state.epochCtx.totalActiveBalanceIncrements / SLOTS_PER_EPOCH) * BUILDER_PAYMENT_THRESHOLD_NUMERATOR;

  return Math.floor(quorum / BUILDER_PAYMENT_THRESHOLD_DENOMINATOR) * EFFECTIVE_BALANCE_INCREMENT;
}
