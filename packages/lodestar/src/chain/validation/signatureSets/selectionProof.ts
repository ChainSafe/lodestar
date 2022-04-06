import {DOMAIN_SELECTION_PROOF} from "@chainsafe/lodestar-params";
import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";
import type {PublicKey} from "@chainsafe/bls/types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSelectionProofSignatureSet(
  state: CachedBeaconStateAllForks,
  slot: Slot,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const selectionProofDomain = state.config.getDomain(DOMAIN_SELECTION_PROOF, slot);

  return {
    type: SignatureSetType.single,
    pubkey: aggregator,
    signingRoot: computeSigningRoot(ssz.Slot, slot, selectionProofDomain),
    signature: aggregateAndProof.message.selectionProof,
  };
}
