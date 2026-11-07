import {routes} from "@lodestar/api";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import type {RootHex, Slot} from "@lodestar/types";

export type HeadEvent = routes.events.EventData[routes.events.EventType.headV2];

type TrackedHead = {
  slot: Slot;
  /** Dependent root of the proposer duties in the epoch of the head block */
  currentEpochDependentRoot: RootHex;
  /** Dependent root of the proposer duties in the epoch after the head block */
  nextEpochDependentRoot: RootHex;
};

/**
 * Tracks the heads announced by the beacon node over `head_v2` events and the proposer duties dependent
 * roots they carry. A bid is validated against the proposer preferences of its parent branch, the dependent
 * root of a tracked head identifies those without fetching the proposer duties for every build.
 */
export class HeadTracker {
  private readonly heads = new Map<RootHex, TrackedHead>();

  onHead(data: HeadEvent["data"]): void {
    const {slot, block, currentEpochDependentRoot, nextEpochDependentRoot} = data;
    this.heads.set(block, {slot, currentEpochDependentRoot, nextEpochDependentRoot});
  }

  /**
   * Dependent root of the proposer duties for `proposalSlot` on the branch of `blockRoot`. Returns null if
   * the block was not announced as head or the proposal is more than one epoch ahead of it.
   */
  getDependentRoot(blockRoot: RootHex, proposalSlot: Slot): RootHex | null {
    const head = this.heads.get(blockRoot);
    if (head === undefined) {
      return null;
    }

    const epochDifference = computeEpochAtSlot(proposalSlot) - computeEpochAtSlot(head.slot);
    if (epochDifference === 0) {
      return head.currentEpochDependentRoot;
    }
    if (epochDifference === 1) {
      return head.nextEpochDependentRoot;
    }
    return null;
  }

  /** Drops heads from before the previous epoch, their dependent roots cannot cover a proposal from `currentSlot` on */
  prune(currentSlot: Slot): number {
    const minSlot = computeStartSlotAtEpoch(Math.max(computeEpochAtSlot(currentSlot) - 1, 0));
    let removed = 0;
    for (const [blockRoot, head] of this.heads) {
      if (head.slot < minSlot) {
        this.heads.delete(blockRoot);
        removed++;
      }
    }
    return removed;
  }
}
