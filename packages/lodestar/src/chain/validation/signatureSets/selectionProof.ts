import {DOMAIN_SELECTION_PROOF} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {phase0, Slot, ssz} from "@chainsafe/lodestar-types";
import {PublicKey} from "@chainsafe/bls";
import {computeSigningRoot, ISignatureSet, SignatureSetType} from "@chainsafe/lodestar-beacon-state-transition";

export function getSelectionProofSignatureSet(
  config: IBeaconConfig,
  slot: Slot,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const selectionProofDomain = config.getDomain(DOMAIN_SELECTION_PROOF, slot);

  return {
    type: SignatureSetType.single,
    pubkey: aggregator,
    signingRoot: computeSigningRoot(ssz.Slot, slot, selectionProofDomain),
    signature: aggregateAndProof.message.selectionProof.valueOf() as Uint8Array,
  };
}
