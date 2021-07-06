import {DOMAIN_AGGREGATE_AND_PROOF} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {Epoch, phase0} from "@chainsafe/lodestar-types";
import {PublicKey} from "@chainsafe/bls";
import {
  allForks,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getAggregateAndProofSignatureSet(
  state: allForks.CachedBeaconState<allForks.BeaconState>,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(epoch);
  const aggregatorDomain = state.config.getDomain(DOMAIN_AGGREGATE_AND_PROOF, slot);
  const signingRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof.message, aggregatorDomain);

  return {
    type: SignatureSetType.single,
    pubkey: aggregator,
    signingRoot,
    signature: aggregateAndProof.signature.valueOf() as Uint8Array,
  };
}
