import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

/**
 * Tracks the value of the last valid execution payload bid seen per
 * (slot, builder, parent block hash, parent block root).
 */
export class SeenExecutionPayloadBids {
  private readonly valueByBranchByBuilderBySlot = new MapDef<Slot, MapDef<BuilderIndex, Map<string, number>>>(
    () => new MapDef<BuilderIndex, Map<string, number>>(() => new Map<string, number>())
  );
  private lowestPermissibleSlot: Slot = 0;

  getValue(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): number | null {
    return (
      this.valueByBranchByBuilderBySlot
        .get(slot)
        ?.get(builderIndex)
        ?.get(branchKey(parentBlockHash, parentBlockRoot)) ?? null
    );
  }

  add(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex, value: number): void {
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`slot ${slot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    this.valueByBranchByBuilderBySlot
      .getOrDefault(slot)
      .getOrDefault(builderIndex)
      .set(branchKey(parentBlockHash, parentBlockRoot), value);
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.valueByBranchByBuilderBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.valueByBranchByBuilderBySlot.delete(slot);
      }
    }
  }
}

function branchKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}
