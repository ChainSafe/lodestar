import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {computeSlotsSinceEpochStart} from "../../util";
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
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(slot);
  const committeeCount = epochCtx.getCommitteeCountAtSlot(slot);
  const committeesSinceEpochStart = committeeCount * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
