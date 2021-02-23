import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Epoch, phase0, Slot} from "@chainsafe/lodestar-types";
import bls, {PublicKey} from "@chainsafe/bls";
import {computeEpochAtSlot, computeSigningRoot, getDomain} from "@chainsafe/lodestar-beacon-state-transition";

export function isValidSelectionProofSignature(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  slot: Slot,
  aggregator: PublicKey,
  signature: Uint8Array
): boolean {
  const epoch = computeEpochAtSlot(config, slot);
  const selectionProofDomain = getDomain(config, state, config.params.DOMAIN_SELECTION_PROOF, epoch);
  const selectionProofSigningRoot = computeSigningRoot(config, config.types.Slot, slot, selectionProofDomain);
  return bls.Signature.fromBytes(signature).verify(aggregator, selectionProofSigningRoot);
}

export function isValidAggregateAndProofSignature(
  config: IBeaconConfig,
  state: phase0.BeaconState,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: phase0.SignedAggregateAndProof
): boolean {
  const aggregatorDomain = getDomain(config, state, config.params.DOMAIN_AGGREGATE_AND_PROOF, epoch);
  const aggregatorSigningRoot = computeSigningRoot(
    config,
    config.types.phase0.AggregateAndProof,
    aggregateAndProof.message,
    aggregatorDomain
  );

  return bls.Signature.fromBytes(aggregateAndProof.signature.valueOf() as Uint8Array).verify(
    aggregator,
    aggregatorSigningRoot
  );
}
