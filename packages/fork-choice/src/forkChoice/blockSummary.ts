import {fromHexString} from "@chainsafe/ssz";
import {Epoch, Slot} from "@chainsafe/lodestar-types";

import {IProtoBlock} from "../protoArray";

export interface IBlockSummary {
  slot: Slot;
  blockRoot: Uint8Array;
  parentRoot: Uint8Array;
  stateRoot: Uint8Array;
  targetRoot: Uint8Array;
  justifiedEpoch: Epoch;
  finalizedEpoch: Epoch;
}

export function toBlockSummary(block: IProtoBlock): IBlockSummary {
  return {
    slot: block.slot,
    blockRoot: fromHexString(block.blockRoot),
    parentRoot: fromHexString(block.parentRoot),
    stateRoot: fromHexString(block.stateRoot),
    targetRoot: fromHexString(block.targetRoot),
    justifiedEpoch: block.justifiedEpoch,
    finalizedEpoch: block.finalizedEpoch,
  };
}
