import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateDecoupled} from "../types.js";

// Spec: process_builder_payment_participation (decoupled-consensus/beacon-chain.md)
export function processBuilderPaymentParticipation(state: CachedBeaconStateDecoupled): void {
  const participation = state.builderPaymentParticipation;
  for (let i = 0; i < SLOTS_PER_EPOCH; i++) {
    participation.set(i, participation.get(i + SLOTS_PER_EPOCH));
  }
  for (let i = SLOTS_PER_EPOCH; i < 2 * SLOTS_PER_EPOCH; i++) {
    participation.set(i, ssz.decoupled.AvailableChainCommitteeIndices.defaultViewDU());
  }
}
