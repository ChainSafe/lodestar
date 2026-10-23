import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateEip8453, CachedBeaconStateGloas} from "../types.js";
import {hasBuilderPaymentQuorum} from "../util/eip8453.js";
import {getBuilderPaymentQuorumThreshold} from "../util/gloas.js";

/**
 * Processes the builder pending payments from the previous epoch.
 */
export function processBuilderPendingPayments(state: CachedBeaconStateGloas): void {
  const quorum = getBuilderPaymentQuorumThreshold(state);

  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    const payment = state.builderPendingPayments.get(i);
    if (payment.weight >= quorum) {
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

/**
 * Spec: process_builder_pending_payments [Modified in EIP8453]
 * Payments are weighed by the head vote seats recorded in `head_vote_participation`, which rotates with them.
 */
export function processBuilderPendingPaymentsEip8453(state: CachedBeaconStateEip8453): void {
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    const payment = state.builderPendingPayments.get(i);
    if (payment.withdrawal.amount === 0) {
      continue;
    }
    if (hasBuilderPaymentQuorum(state.headVoteParticipation.get(i).toValue())) {
      state.builderPendingWithdrawals.push(payment.withdrawal);
    }
  }

  for (let i = 0; i < state.builderPendingPayments.length; i++) {
    if (i < SLOTS_PER_EPOCH) {
      state.builderPendingPayments.set(i, state.builderPendingPayments.get(i + SLOTS_PER_EPOCH).clone());
      state.headVoteParticipation.set(i, state.headVoteParticipation.get(i + SLOTS_PER_EPOCH).clone());
    } else {
      state.builderPendingPayments.set(i, ssz.gloas.BuilderPendingPayment.defaultViewDU());
      state.headVoteParticipation.set(i, ssz.eip8453.HeadVoteCommitteeBits.defaultViewDU());
    }
  }
}
