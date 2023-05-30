import {DOMAIN_AGGREGATE_AND_PROOF} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Epoch, phase0} from "@lodestar/types";
import type {PublicKey} from "@chainsafe/bls/types";
import {
  CachedBeaconStateAllForks,
  computeSigningRoot,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  ISignatureSet,
} from "@lodestar/state-transition";

export function getAggregateAndProofSigningRoot(
  state: CachedBeaconStateAllForks,
  epoch: Epoch,
  aggregateAndProof: phase0.SignedAggregateAndProof
): Uint8Array {
  const slot = computeStartSlotAtEpoch(epoch);
  const aggregatorDomain = state.config.getDomain(state.slot, DOMAIN_AGGREGATE_AND_PROOF, slot);
  return computeSigningRoot(ssz.phase0.AggregateAndProof, aggregateAndProof.message, aggregatorDomain);
}

export function getAggregateAndProofSignatureSet(
  state: CachedBeaconStateAllForks,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  return createSingleSignatureSetFromComponents(
    aggregator,
    getAggregateAndProofSigningRoot(state, epoch, aggregateAndProof),
    aggregateAndProof.signature
  );
}
