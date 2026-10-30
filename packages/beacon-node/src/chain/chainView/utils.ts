import {PayloadStatus} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {BlockRootSlot} from "../../util/sszBytes.js";
import {IChainView} from "./interface.js";

type BlockRootSlotsByRange = {finalizedSlot: Slot; nonFinalized: BlockRootSlot[]};

export function getCanonicalBlockRootSlotsByRange(
  chainView: IChainView,
  startSlot: Slot,
  endSlot: Slot
): BlockRootSlotsByRange {
  const finalizedSlot = computeStartSlotAtEpoch(chainView.getFinalizedCheckpoint().epoch);
  const head = chainView.getHead();
  const nonFinalized = chainView
    .getAllAncestorBlocks(head.blockRoot, head.payloadStatus)
    .filter((block) => block.slot > finalizedSlot && block.slot >= startSlot && block.slot < endSlot)
    .reverse()
    .map((block) => ({slot: block.slot, root: fromHex(block.blockRoot)}));
  return {finalizedSlot, nonFinalized};
}

export function getFullBlockRootSlotsByRange(
  chainView: IChainView,
  startSlot: Slot,
  endSlot: Slot
): BlockRootSlotsByRange {
  // The finalized block's envelope remains hot until the next archive run.
  const finalizedSlot = chainView.getFinalizedBlock().slot;
  const head = chainView.getHead();
  const nonFinalized = chainView
    .getAllAncestorBlocks(head.blockRoot, head.payloadStatus)
    .filter(
      (block) =>
        block.slot >= finalizedSlot &&
        block.slot >= startSlot &&
        block.slot < endSlot &&
        block.payloadStatus === PayloadStatus.FULL
    )
    .reverse()
    .map((block) => ({slot: block.slot, root: fromHex(block.blockRoot)}));
  return {finalizedSlot, nonFinalized};
}
