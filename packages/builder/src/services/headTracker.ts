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
  private head: {slot: Slot; state: RootHex} | null = null;
  private headOptimistic = false;

  onHead(data: HeadEvent["data"]): void {
    const {slot, block, state, currentEpochDependentRoot, nextEpochDependentRoot, executionOptimistic} = data;
    this.heads.set(block, {slot, currentEpochDependentRoot, nextEpochDependentRoot});
    this.head = {slot, state};
    this.headOptimistic = executionOptimistic;
  }

  /** Slot and state root of the latest head announced by the beacon node, null before the first head event */
  getHead(): {slot: Slot; state: RootHex} | null {
    return this.head;
  }

  /**
   * Whether the latest head announced by the beacon node is optimistic. A head that becomes valid without a head
   * change stays optimistic until the next head event.
   */
  isHeadOptimistic(): boolean {
    return this.headOptimistic;
  }

  /**
   * Dependent root of the proposer duties for `proposalSlot` on the branch of `blockRoot`.
   * Returns null if the block was not announced as head.
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
    return blockRoot;
  }

  /**
   * Drops heads from before the previous epoch. An older head is only the parent of a proposal after a full
   * epoch without blocks, the proposer duties fallback covers that.
   */
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
