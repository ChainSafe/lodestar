import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {Slot} from "@chainsafe/lodestar-types";
import {ATTESTATION_PROPAGATION_SLOT_RANGE, MAXIMUM_GOSSIP_CLOCK_DISPARITY} from "../../../../constants";

export function hasValidAttestationSlot(config: IBeaconConfig, genesisTime: number, slot: Slot): boolean {
  const milliSecPerSlot = config.params.SECONDS_PER_SLOT * 1000;
  const currentSlotTime = getCurrentSlot(config, genesisTime) * milliSecPerSlot;
  return (
    (slot + ATTESTATION_PROPAGATION_SLOT_RANGE) * milliSecPerSlot + MAXIMUM_GOSSIP_CLOCK_DISPARITY >= currentSlotTime &&
    currentSlotTime >= slot * milliSecPerSlot - MAXIMUM_GOSSIP_CLOCK_DISPARITY
  );
}
