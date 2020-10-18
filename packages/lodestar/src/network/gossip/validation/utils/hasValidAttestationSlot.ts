import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Slot} from "@chainsafe/lodestar-types";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../constants";

export function hasValidAttestationSlot(config: IBeaconConfig, currentSlot: Slot, slot: Slot): boolean {
  const milliSecPerSlot = config.params.SECONDS_PER_SLOT * 1000;
  const currentSlotTime = currentSlot * milliSecPerSlot;
  return (
    (slot + ATTESTATION_PROPAGATION_SLOT_RANGE) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY >= currentSlotTime &&
    currentSlotTime >= slot * milliSecPerSlot - MAXIMUM_GOSSIP_CLOCK_DISPARITY
  );
}
