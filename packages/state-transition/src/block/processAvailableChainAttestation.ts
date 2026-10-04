import {Slot, decoupled} from "@lodestar/types";
import {CachedBeaconStateDecoupled} from "../types.js";
import {
  isMatchingHeadAttestation,
  isValidAvailableChainAttestation,
  updateBuilderPaymentParticipation,
} from "../util/decoupled.js";

// Spec: process_available_chain_attestation (decoupled-consensus/beacon-chain.md)
export function processAvailableChainAttestation(
  state: CachedBeaconStateDecoupled,
  attestation: decoupled.AvailableChainAttestation,
  parentSlot: Slot,
  verifySignature = true
): void {
  if (!isValidAvailableChainAttestation(state, attestation, verifySignature)) {
    throw Error(`Invalid available chain attestation at slot ${attestation.data.slot}`);
  }

  updateBuilderPaymentParticipation(state, attestation);

  if (isMatchingHeadAttestation(state, attestation.data, parentSlot)) {
    // [TODO in spec: timely head and proposer reward logic]
  }
}
