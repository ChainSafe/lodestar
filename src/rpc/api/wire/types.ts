import {Slot} from "../../types/primitive"

export interface BlockRootSlot {
  block_root: Buffer;
  slot: Slot;
}

export interface HashTreeRoot {
  hash: Buffer;
}
