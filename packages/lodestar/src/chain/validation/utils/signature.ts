import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Epoch, SignedAggregateAndProof, Slot} from "@chainsafe/lodestar-types";
import bls, {IPublicKey} from "@chainsafe/bls";
import {computeEpochAtSlot, computeSigningRoot, getDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {DomainType} from "../../../constants";

export function isValidSelectionProofSignature(
  config: IBeaconConfig,
  state: BeaconState,
  slot: Slot,
  aggregator: IPublicKey,
  signature: Uint8Array
): boolean {
  const epoch = computeEpochAtSlot(config, slot);
  const selectionProofDomain = getDomain(config, state, DomainType.SELECTION_PROOF, epoch);
  const selectionProofSigningRoot = computeSigningRoot(config, config.types.Slot, slot, selectionProofDomain);
  return bls.Signature.fromBytes(signature).verify(aggregator, selectionProofSigningRoot);
}

export function isValidAggregateAndProofSignature(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch,
  aggregator: IPublicKey,
  aggregateAndProof: SignedAggregateAndProof
): boolean {
  const aggregatorDomain = getDomain(config, state, DomainType.AGGREGATE_AND_PROOF, epoch);
  const aggregatorSigningRoot = computeSigningRoot(
    config,
    config.types.AggregateAndProof,
    aggregateAndProof.message,
    aggregatorDomain
  );
  return bls.Signature.fromBytes(aggregateAndProof.signature.valueOf() as Uint8Array).verify(
    aggregator,
    aggregatorSigningRoot
  );
}
