// This file makes some naive assumptions surrounding the way RPC like calls will be made in ETH2.0
// Subject to change with future developments with Hobbits and wire protocol
import {ValidatorIndex, Slot, Epoch, BeaconBlock, BeaconState, bytes48, CrosslinkCommittee} from "../../types/index";
import {GenesisInfo} from "../types";

// Super awesome stubs
export function notSoRandomRandomBoolean(): boolean {
  return [true, false][Math.round(Math.random())];
}

export function notSoRandomRandomValidatorIndex(): ValidatorIndex {
  return Math.round(Math.random() * 1000);
}

export function notSoRandomRandomSlot(): Slot {
  return Math.round(Math.random() * 1000);
}

