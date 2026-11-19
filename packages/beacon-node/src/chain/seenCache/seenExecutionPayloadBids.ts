import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

/**
 * Tracks execution payload bids we've already seen per
 * (slot, builder, parent block hash, parent block root).
 */
export class SeenExecutionPayloadBids {
  private readonly branchesByBuilderBySlot = new MapDef<Slot, MapDef<BuilderIndex, Set<string>>>(
    () => new MapDef<BuilderIndex, Set<string>>(() => new Set<string>())
  );
  private lowestPermissibleSlot: Slot = 0;

  isKnown(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): boolean {
    return (
      this.branchesByBuilderBySlot.get(slot)?.get(builderIndex)?.has(branchKey(parentBlockHash, parentBlockRoot)) ===
      true
    );
  }

  add(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): void {
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`slot ${slot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    this.branchesByBuilderBySlot
      .getOrDefault(slot)
      .getOrDefault(builderIndex)
      .add(branchKey(parentBlockHash, parentBlockRoot));
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.branchesByBuilderBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.branchesByBuilderBySlot.delete(slot);
      }
    }
  }
}

function branchKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}
