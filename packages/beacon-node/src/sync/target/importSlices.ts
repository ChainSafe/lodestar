import {computeEpochAtSlot} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {HeaderChain, HeaderChainElement} from "./types.js";

/**
 * A contiguous run of `HeaderChainElement`s that all belong to the same epoch.
 * Produced by `sliceHeaderChainByEpoch` and consumed by TargetSync import.
 */
export type ImportSegment = {
  epoch: Epoch;
  elements: HeaderChainElement[];
};

/**
 * Partitions a slot-ascending `HeaderChain` (bottom→top) into contiguous
 * same-epoch segments, preserving original order (oldest epoch first).
 *
 * `verifyBlocksInEpoch` requires all blocks in a single import call to share
 * the same epoch, which is why slices are per-epoch.
 *
 * Pure function — no I/O, no side effects.
 */
export function sliceHeaderChainByEpoch(headerChain: HeaderChain): ImportSegment[] {
  const segments: ImportSegment[] = [];

  for (const element of headerChain) {
    const epoch = computeEpochAtSlot(element.slot);
    const current = segments.at(-1);

    if (current !== undefined && current.epoch === epoch) {
      current.elements.push(element);
    } else {
      segments.push({epoch, elements: [element]});
    }
  }

  return segments;
}
