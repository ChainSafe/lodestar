import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateGloas} from "../types.ts";
import {computeExitEpochAndUpdateChurn} from "../util/epoch.ts";
import {getBuilderPaymentQuorumThreshold} from "../util/gloas.ts";

/**
 * Processes the builder pending payments from the previous epoch.
 */
export function processBuilderPendingPayments(state: CachedBeaconStateGloas): void {
  const quorum = getBuilderPaymentQuorumThreshold(state);

  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    const payment = state.builderPendingPayments.get(i);
    if (payment.weight > quorum) {
      const exitQueueEpoch = computeExitEpochAndUpdateChurn(state, BigInt(payment.withdrawal.amount));
      payment.withdrawal.withdrawableEpoch = exitQueueEpoch + state.config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY;

      state.builderPendingWithdrawals.push(payment.withdrawal);
    }
  }

  // TODO GLOAS: Optimize this
  for (let i = 0; i < state.builderPendingPayments.length; i++) {
    if (i < SLOTS_PER_EPOCH) {
      state.builderPendingPayments.set(i, state.builderPendingPayments.get(i + SLOTS_PER_EPOCH).clone());
    } else {
      state.builderPendingPayments.set(i, ssz.gloas.BuilderPendingPayment.defaultViewDU());
    }
  }
}
