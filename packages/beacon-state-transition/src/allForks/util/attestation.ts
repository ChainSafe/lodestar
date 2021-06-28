import {ATTESTATION_SUBNET_COUNT, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {computeEpochAtSlot} from "../../util";
import {EpochContext} from "./epochContext";

/**
 * Compute the correct subnet for an attestation
 */
export function computeSubnetForAttestation(epochCtx: EpochContext, attestation: phase0.Attestation): number {
  const {slot, index} = attestation.data;
  return computeSubnetForSlot(epochCtx, slot, index);
}

/**
 * Compute the correct subnet for a slot/committee index
 */
export function computeSubnetForSlot(epochCtx: EpochContext, slot: number, committeeIndex: number): number {
  const slotsSinceEpochStart = slot % SLOTS_PER_EPOCH;
  const committeesPerSlot = epochCtx.getCommitteeCountPerSlot(computeEpochAtSlot(slot));
  const committeesSinceEpochStart = committeesPerSlot * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
