import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Epoch, phase0} from "@chainsafe/lodestar-types";
import {PublicKey} from "@chainsafe/bls";
import {
  CachedBeaconState,
  computeSigningRoot,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";
import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";

export function getAggregateAndProofSignatureSet(
  config: IBeaconConfig,
  state: CachedBeaconState<allForks.BeaconState>,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const slot = computeStartSlotAtEpoch(config, epoch);
  const aggregatorDomain = state.getDomain(config.params.DOMAIN_AGGREGATE_AND_PROOF, slot);
  const signingRoot = computeSigningRoot(
    config,
    config.types.phase0.AggregateAndProof,
    aggregateAndProof.message,
    aggregatorDomain
  );

  return {
    type: SignatureSetType.single,
    pubkey: aggregator,
    signingRoot,
    signature: aggregateAndProof.signature.valueOf() as Uint8Array,
  };
}
