import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {computeSlotsSinceEpochStart} from "../../util";
import {EpochContext} from "./epochContext";

/**
 * Compute the correct subnet for an attestation
 */
export function computeSubnetForAttestation(
  config: IBeaconConfig,
  epochCtx: EpochContext,
  attestation: phase0.Attestation
): number {
  const {slot, index} = attestation.data;
  return computeSubnetForSlot(config, epochCtx, slot, index);
}

/**
 * Compute the correct subnet for a slot/committee index
 */
export function computeSubnetForSlot(
  config: IBeaconConfig,
  epochCtx: EpochContext,
  slot: number,
  committeeIndex: number
): number {
  const slotsSinceEpochStart = computeSlotsSinceEpochStart(config, slot);
  const committeeCount = epochCtx.getCommitteeCountAtSlot(slot);
  const committeesSinceEpochStart = committeeCount * slotsSinceEpochStart;
  return (committeesSinceEpochStart + committeeIndex) % ATTESTATION_SUBNET_COUNT;
}
