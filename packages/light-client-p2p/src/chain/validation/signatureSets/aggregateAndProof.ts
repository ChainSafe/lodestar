import {DOMAIN_AGGREGATE_AND_PROOF} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Epoch, phase0} from "@lodestar/types";
import type {PublicKey} from "@chainsafe/bls/types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  ISignatureSet,
  SignatureSetType,
} from "@lodestar/state-transition";

export function getAggregateAndProofSignatureSet(
  state: CachedBeaconStateAllForks,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(epoch);
  const aggregatorDomain = state.config.getDomain(state.slot, DOMAIN_AGGREGATE_AND_PROOF, slot);
  const signingRoot = computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof.message, aggregatorDomain);

  return {
    type: SignatureSetType.single,
    pubkey: aggregator,
    signingRoot,
    signature: aggregateAndProof.signature,
  };
}
