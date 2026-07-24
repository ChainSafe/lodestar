import {BuilderIndex, RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

/**
 * Tracks execution payload bids we've already seen per
 * (slot, builder, parent_block_hash, parent_block_root), allowing a builder
 * to submit one bid per branch it wants to build on, up to
 * MAX_BIDS_PER_BUILDER_PER_SLOT bids per slot.
 */
export class SeenExecutionPayloadBids {
  private readonly tupleKeysByBuilderBySlot = new MapDef<Slot, MapDef<BuilderIndex, Set<string>>>(
    () => new MapDef<BuilderIndex, Set<string>>(() => new Set<string>())
  );
  private lowestPermissibleSlot: Slot = 0;

  isKnown(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): boolean {
    return (
      this.tupleKeysByBuilderBySlot.get(slot)?.get(builderIndex)?.has(tupleKey(parentBlockHash, parentBlockRoot)) ===
      true
    );
  }

  seenCount(slot: Slot, builderIndex: BuilderIndex): number {
    return this.tupleKeysByBuilderBySlot.get(slot)?.get(builderIndex)?.size ?? 0;
  }

  add(slot: Slot, builderIndex: BuilderIndex, parentBlockHash: RootHex, parentBlockRoot: RootHex): void {
    if (slot < this.lowestPermissibleSlot) {
      throw Error(`slot ${slot} < lowestPermissibleSlot ${this.lowestPermissibleSlot}`);
    }
    this.tupleKeysByBuilderBySlot
      .getOrDefault(slot)
      .getOrDefault(builderIndex)
      .add(tupleKey(parentBlockHash, parentBlockRoot));
  }

  prune(currentSlot: Slot): void {
    this.lowestPermissibleSlot = Math.max(currentSlot - SLOTS_RETAINED, 0);
    for (const slot of this.tupleKeysByBuilderBySlot.keys()) {
      if (slot < this.lowestPermissibleSlot) {
        this.tupleKeysByBuilderBySlot.delete(slot);
      }
    }
  }
}

function tupleKey(parentBlockHash: RootHex, parentBlockRoot: RootHex): string {
  return `${parentBlockHash}:${parentBlockRoot}`;
}
