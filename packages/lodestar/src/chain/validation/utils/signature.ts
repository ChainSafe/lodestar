import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, Epoch, phase0, Slot} from "@chainsafe/lodestar-types";
import {PublicKey} from "@chainsafe/bls";
import {
  computeEpochAtSlot,
  computeSigningRoot,
  getDomain,
  ISignatureSet,
  SignatureSetType,
} from "@chainsafe/lodestar-beacon-state-transition";

export function getSelectionProofSignatureSet(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  slot: Slot,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const epoch = computeEpochAtSlot(config, slot);
  const selectionProofDomain = getDomain(config, state, config.params.DOMAIN_SELECTION_PROOF, epoch);

  return {
    type: SignatureSetType.single,
    pubkey: aggregator,
    signingRoot: computeSigningRoot(config, config.types.Slot, slot, selectionProofDomain),
    signature: aggregateAndProof.message.selectionProof.valueOf() as Uint8Array,
  };
}

export function getAggregateAndProofSignatureSet(
  config: IBeaconConfig,
  state: allForks.BeaconState,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): ISignatureSet {
  const aggregatorDomain = getDomain(config, state, config.params.DOMAIN_AGGREGATE_AND_PROOF, epoch);
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
