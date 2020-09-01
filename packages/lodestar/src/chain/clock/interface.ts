import {Epoch, Slot} from "@chainsafe/lodestar-types";

export interface IBeaconClock {
  readonly currentSlot: Slot;
  readonly currentEpoch: Epoch;
  abort(): void;
}
