import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

/**
 * Counts the valid execution payload bids seen per
 * (slot, builder, parent block hash, parent block root).
 */
export class SeenExecutionPayloadBids {
  private readonly countByBranchByBuilderBySlot = new MapDef<Slot, MapDef<BuilderIndex, Map<string, number>>>(
    () => new MapDef<BuilderIndex, Map<string, number>>(() => new Map<string, number>())
  );
  private lowestPermissibleSlot: Slot = 0;

  getCount(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): number {
    return (
      this.countByBranchByBuilderBySlot
        .get(slot)
        ?.get(builderIndex)
        ?.get(branchKey(parentBlockHash, parentBlockRoot)) ?? 0
    );
  }

  add(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): void {
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`slot ${slot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    const countByBranch = this.countByBranchByBuilderBySlot.getOrDefault(slot).getOrDefault(builderIndex);
    const key = branchKey(parentBlockHash, parentBlockRoot);
    countByBranch.set(key, (countByBranch.get(key) ?? 0) + 1);
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.countByBranchByBuilderBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.countByBranchByBuilderBySlot.delete(slot);
      }
    }
  }
}

function branchKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}
