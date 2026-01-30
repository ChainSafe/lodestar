import {BuilderIndex, RootHex, Slot} from "@lodestar/types";

type SeenExecutionPayloadEnvelopeEntry = {
  slot: Slot;
  builderIndexes: Set<BuilderIndex>;
};

/**
 * Cache to prevent processing multiple execution payload envelopes for the same block root from the same builder.
 * We only keep track of envelopes of unfinalized slots
 * _[IGNORE]_ The node has not seen another valid
 *  `SignedExecutionPayloadEnvelope` for this block root from this builder.
 */
export class SeenExecutionPayloadEnvelopes {
  private readonly builderIndexesByBlockRoot = new Map<RootHex, SeenExecutionPayloadEnvelopeEntry>();
  private finalizedSlot: Slot = 0;

  isKnown(blockRoot: RootHex, builderIndex: BuilderIndex): boolean {
    return this.builderIndexesByBlockRoot.get(blockRoot)?.builderIndexes.has(builderIndex) === true;
  }

  add(blockRoot: RootHex, slot: Slot, builderIndex: BuilderIndex): void {
    if (slot < this.finalizedSlot) {
      throw Error(`slot ${slot} < finalizedSlot ${this.finalizedSlot}`);
    }

    let entry = this.builderIndexesByBlockRoot.get(blockRoot);
    if (!entry) {
      entry = {slot, builderIndexes: new Set<BuilderIndex>()};
      this.builderIndexesByBlockRoot.set(blockRoot, entry);
    }

    entry.builderIndexes.add(builderIndex);
  }

  prune(finalizedSlot: Slot): void {
    this.finalizedSlot = finalizedSlot;

    for (const [blockRoot, {slot}] of this.builderIndexesByBlockRoot.entries()) {
      if (slot < finalizedSlot) {
        this.builderIndexesByBlockRoot.delete(blockRoot);
      }
    }
  }
}
