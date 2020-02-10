import {Slot} from "@chainsafe/eth2.0-types";
import {IService} from "../../node";

export interface IBeaconClock extends IService {
    getCurrentSlot(): Slot;
    onNewSlot(cb: (slot: Slot) => void): void;
    onNewEpoch(cb: (slot: Slot) => void): void;
}