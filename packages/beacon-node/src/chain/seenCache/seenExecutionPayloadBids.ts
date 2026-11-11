import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

export type SeenBuilderBids = {
  /** Number of valid bids seen */
  count: number;
  /**
   * The builder's bid limit. Bids for the same slot and parent root are validated against the same state,
   * so it is known without the state once a bid was valid
   */
  limit: number;
};

/**
 * Counts the valid execution payload bids seen per
 * (slot, builder, parent block hash, parent block root).
 */
export class SeenExecutionPayloadBids {
  private readonly bidsByBranchByBuilderBySlot = new MapDef<Slot, MapDef<BuilderIndex, Map<string, SeenBuilderBids>>>(
    () => new MapDef<BuilderIndex, Map<string, SeenBuilderBids>>(() => new Map<string, SeenBuilderBids>())
  );
  private lowestPermissibleSlot: Slot = 0;

  get(
    slot: Slot,
    builderIndex: BuilderIndex,
    parentBlockHash: RootHex,
    parentBlockRoot: RootHex
  ): SeenBuilderBids | undefined {
    return this.bidsByBranchByBuilderBySlot
      .get(slot)
      ?.get(builderIndex)
      ?.get(branchKey(parentBlockHash, parentBlockRoot));
  }

  add(
    slot: Slot,
    builderIndex: BuilderIndex,
    parentBlockHash: RootHex,
    parentBlockRoot: RootHex,
    bidLimit: number
  ): void {
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`slot ${slot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    const bidsByBranch = this.bidsByBranchByBuilderBySlot.getOrDefault(slot).getOrDefault(builderIndex);
    const key = branchKey(parentBlockHash, parentBlockRoot);
    bidsByBranch.set(key, {count: (bidsByBranch.get(key)?.count ?? 0) + 1, limit: bidLimit});
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.bidsByBranchByBuilderBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.bidsByBranchByBuilderBySlot.delete(slot);
      }
    }
  }
}

function branchKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}
