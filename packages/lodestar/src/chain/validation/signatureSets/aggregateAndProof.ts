import {DOMAIN_AGGREGATE_AND_PROOF} from "@chainsafe/lodestar-params";
import {ssz} from "@chainsafe/lodestar-types";
import {Epoch, phase0} from "@chainsafe/lodestar-types";
import type {PublicKey} from "@chainsafe/bls/types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getAggregateAndProofSignatureSet(
  state: CachedBeaconStateAllForks,
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
    signature: aggregateAndProof.signature,
  };
}
