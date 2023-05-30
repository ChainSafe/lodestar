import {DOMAIN_SELECTION_PROOF} from "@lodestar/params";
import {phase0, Slot, ssz} from "@lodestar/types";
import type {PublicKey} from "@chainsafe/bls/types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  createSingleSignatureSetFromComponents,
  ISignatureSet,
} from "@lodestar/state-transition";

export function getSelectionProofSigningRoot(state: CachedBeaconStateAllForks, slot: Slot): Uint8Array {
  const selectionProofDomain = state.config.getDomain(state.slot, DOMAIN_SELECTION_PROOF, slot);
  return computeSigningRoot(ssz.Slot, slot, selectionProofDomain);
}

export function getSelectionProofSignatureSet(
  state: CachedBeaconStateAllForks,
  slot: Slot,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  return createSingleSignatureSetFromComponents(
    aggregator,
    getSelectionProofSigningRoot(state, slot),
    aggregateAndProof.message.selectionProof
  );
}
