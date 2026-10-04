import {AVAILABLE_CHAIN_COMMITTEE_SIZE, ForkSeq, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks, CachedBeaconStateDecoupled, CachedBeaconStateGloas} from "../types.js";
import {getBuilderPaymentQuorumThresholdDecoupled} from "../util/decoupled.js";
import {getBuilderPaymentQuorumThreshold} from "../util/gloas.js";

/**
 * Processes the builder pending payments from the previous epoch.
 * Spec: process_builder_pending_payments [Modified in DC] (decoupled-consensus/beacon-chain.md)
 */
export function processBuilderPendingPayments(state: CachedBeaconStateGloas): void {
  const {config, epochCtx} = state;
  const previousEpoch = epochCtx.previousShuffling.epoch;
  const isDecoupledEpoch =
    config.getForkSeq(state.slot) >= ForkSeq.decoupled && previousEpoch >= config.DECOUPLED_FORK_EPOCH;

  if (isDecoupledEpoch) {
    const stateDecoupled = state as CachedBeaconStateAllForks as CachedBeaconStateDecoupled;
    const quorum = getBuilderPaymentQuorumThresholdDecoupled(BigInt(AVAILABLE_CHAIN_COMMITTEE_SIZE));
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      const weight = BigInt(stateDecoupled.builderPaymentParticipation.getReadonly(i).length);
      if (weight >= quorum) {
        state.builderPendingWithdrawals.push(state.builderPendingPayments.get(i).withdrawal);
      }
    }
  } else {
    const quorum = getBuilderPaymentQuorumThreshold(state);
    for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
      const payment = state.builderPendingPayments.get(i);
      if (payment.weight >= quorum) {
        state.builderPendingWithdrawals.push(payment.withdrawal);
      }
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
