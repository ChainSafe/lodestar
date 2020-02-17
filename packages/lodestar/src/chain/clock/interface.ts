import {Epoch, Slot} from "@chainsafe/eth2.0-types";
import {IService} from "../../node";

export type NewSlotCallback = (slot: Slot) => void;
export type NewEpochCallback = (epoch: Epoch) => void;

export interface IBeaconClock extends IService {
  getCurrentSlot(): Slot;
  onNewSlot(cb: NewSlotCallback): void;
  onNewEpoch(cb: NewEpochCallback): void;
  unsubscribeFromNewEpoch(cb: NewEpochCallback): void;
  unsubscribeFromNewSlot(cb: NewSlotCallback): void;
}