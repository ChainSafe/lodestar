import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Epoch, Root, SignedAggregateAndProof, Slot} from "@chainsafe/lodestar-types";
import {PublicKey, Signature} from "@chainsafe/bls";
import {computeEpochAtSlot, computeSigningRoot, getDomain} from "@chainsafe/lodestar-beacon-state-transition";
import {DomainType} from "../../../constants";

export function isValidSelectionProofSignature(
  config: IBeaconConfig,
  state: BeaconState,
  slot: Slot,
  aggregator: PublicKey,
  signature: Root
): boolean {
  const epoch = computeEpochAtSlot(config, slot);
  const selectionProofDomain = getDomain(config, state, DomainType.SELECTION_PROOF, epoch);
  const selectionProofSigningRoot = computeSigningRoot(config, config.types.Slot, slot, selectionProofDomain);
  return aggregator.verifyMessage(Signature.fromCompressedBytes(signature as Uint8Array), selectionProofSigningRoot);
}

export function isValidAggregateAndProofSignature(
  config: IBeaconConfig,
  state: BeaconState,
  epoch: Epoch,
  aggregator: PublicKey,
  aggregateAndProof: SignedAggregateAndProof
): boolean {
  const aggregatorDomain = getDomain(config, state, DomainType.AGGREGATE_AND_PROOF, epoch);
  const aggregatorSigningRoot = computeSigningRoot(
    config,
    config.types.AggregateAndProof,
    aggregateAndProof.message,
    aggregatorDomain
  );
  return aggregator.verifyMessage(
    Signature.fromCompressedBytes(aggregateAndProof.signature.valueOf() as Uint8Array),
    aggregatorSigningRoot
  );
}
