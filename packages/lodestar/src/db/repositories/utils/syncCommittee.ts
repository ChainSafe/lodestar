import {phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

export type SlotRootKey = string;
export const NUM_SLOTS_IN_CACHE = 3;

export function slotRootKey(syncCommitteeSignature: {slot: phase0.Slot; beaconBlockRoot: phase0.Root}): SlotRootKey {
  const {slot, beaconBlockRoot} = syncCommitteeSignature;
  return "" + slot + "_" + toHexString(beaconBlockRoot);
}
