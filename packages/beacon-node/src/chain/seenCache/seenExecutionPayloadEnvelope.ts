import {RootHex, Slot} from "@lodestar/types";

/**
 * Cache to prevent processing multiple execution payload envelopes for the same block root.
 * Only one builder qualifies to submit an execution payload for a given slot.
 * We only keep track of envelopes of unfinalized slots.
 * [IGNORE] The node has not seen another valid `SignedExecutionPayloadEnvelope` for this block root.
 */
export class SeenExecutionPayloadEnvelopes {
  private readonly slotByBlockRoot = new Map<RootHex, Slot>();
  private finalizedSlot: Slot = 0;

  isKnown(blockRoot: RootHex): boolean {
    return this.slotByBlockRoot.has(blockRoot);
  }

  add(blockRoot: RootHex, slot: Slot): void {
    if (slot < this.finalizedSlot) {
      throw Error(`slot ${slot} < finalizedSlot ${this.finalizedSlot}`);
    }

    this.slotByBlockRoot.set(blockRoot, slot);
  }

  prune(finalizedSlot: Slot): void {
    this.finalizedSlot = finalizedSlot;

    for (const [blockRoot, slot] of this.slotByBlockRoot.entries()) {
      if (slot < finalizedSlot) {
        this.slotByBlockRoot.delete(blockRoot);
      }
    }
  }
}
