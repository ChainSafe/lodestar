import {PeerId} from "@libp2p/interface-peer-id";
import {Message} from "@libp2p/interface-pubsub";
import {IForkChoice} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {MapDef} from "@lodestar/utils";
import {GossipTopic} from "../gossip/interface.js";
import {
  getTargetFromAttestationSerialized,
  getBlockRootFromAttestationSerialized,
  getSlotFromAttestationSerialized,
} from "../../util/sszBytes.js";

type BlockRootHex = RootHex;
type TargetHex = RootHex;
type AttestationSlot = Slot;

export type GossipAttestationsWork = {
  messages: PendingGossipsubMessage[];
  slot: Slot;
  targetHex: TargetHex;
};

export type PendingGossipsubMessage = {
  topic: GossipTopic;
  msg: Message;
  msgId: string;
  // TODO: Refactor into accepting string (requires gossipsub changes) for easier multi-threading
  propagationSource: PeerId;
  seenTimestampSec: number;
};

export enum AttestationProcessorStatus {
  available,
  full,
}

const ATTESTATION_BATCH_SIZE = 128;
const MAX_ITEMS_CACHE_KNOWN_BLOCK = 16000;
const MAX_ITEMS_CACHE_UNKNOWN_BLOCK = 16000;
const MAX_SLOTS_CACHE_KNOWN_BLOCK = SLOTS_PER_EPOCH;
const MAX_SLOTS_CACHE_UNKNOWN_BLOCK = 2;

export class GossipsubAttestationQueue {
  private readonly unknownBlockRootQueuesBySlot = new AttestationQueueUnknownBlock<PendingGossipsubMessage>();
  /** Rolling array indexed by slot % SLOTS_PER_EPOCH */
  private readonly knownBlockRootQueuesBySlot = new AttestationQueueKnownBlock<PendingGossipsubMessage>(
    ATTESTATION_BATCH_SIZE
  );

  constructor(private readonly forkChoice: Pick<IForkChoice, "getBlockHex">, private currentSlot: Slot) {}

  onAttestation(data: PendingGossipsubMessage): void {
    const blockRootHex = getBlockRootFromAttestationSerialized(data.msg.data);
    const attestationSlot = getSlotFromAttestationSerialized(data.msg.data);

    // Attests unknown block, hold temporarily
    const block = this.forkChoice.getBlockHex(blockRootHex);
    if (!block) {
      // Instead of pruning to max, prevent adding more attestations beyond max
      if (this.unknownBlockRootQueuesBySlot.size > MAX_ITEMS_CACHE_UNKNOWN_BLOCK) {
        throw Error("queue full");
      }

      if (attestationSlot < this.currentSlot - MAX_SLOTS_CACHE_UNKNOWN_BLOCK) {
        // TODO: Should discard old attestations too?
        throw Error("IGNORE too old");
      }

      // Should prune here too? Or maybe inside the data structures?

      this.unknownBlockRootQueuesBySlot.add(data, attestationSlot, blockRootHex);
      return;
    }

    // Discard old attestations immediatelly
    if (attestationSlot < this.currentSlot - MAX_SLOTS_CACHE_KNOWN_BLOCK) {
      throw Error("IGNORE too old");
    }

    // Add attestations such that there's not a batch bigger than ATTESTATION_BATCH_SIZE
    this.addAttestationKnownBlock(data, attestationSlot);
  }

  onImportedBlock(blockRoot: BlockRootHex): void {
    for (const {slot, items} of this.unknownBlockRootQueuesBySlot.consumeByBlockRoot(blockRoot)) {
      for (const item of items) {
        this.addAttestationKnownBlock(item, slot);
      }
    }
  }

  /**
   * Advance internal clock slot, and drop data at past slots
   */
  onSlot(newCurrentSlot: Slot): void {
    // Prune unknown block attestations
    for (
      let slot = this.currentSlot - MAX_SLOTS_CACHE_UNKNOWN_BLOCK;
      slot < newCurrentSlot - MAX_SLOTS_CACHE_UNKNOWN_BLOCK;
      slot++
    ) {
      this.unknownBlockRootQueuesBySlot.pruneBySlot(slot);
    }

    // Prune known block attestations
    for (
      let slot = this.currentSlot - MAX_SLOTS_CACHE_KNOWN_BLOCK;
      slot < newCurrentSlot - MAX_SLOTS_CACHE_KNOWN_BLOCK;
      slot++
    ) {
      for (const _ of this.knownBlockRootQueuesBySlot.consumeBySlot(slot)) {
        // Drop
      }
    }

    this.currentSlot = newCurrentSlot;
  }

  getWork(): GossipAttestationsWork | null {
    // Process queued attestations from newest to oldest
    for (let slot = this.currentSlot; slot > this.currentSlot - MAX_SLOTS_CACHE_KNOWN_BLOCK; slot--) {
      // TODO: Refactor with a return one item design
      for (const batch of this.knownBlockRootQueuesBySlot.consumeBySlot(slot)) {
        return {messages: batch.items, slot, targetHex: batch.target};
      }
    }

    return null;
  }

  private addAttestationKnownBlock(item: PendingGossipsubMessage, slot: AttestationSlot): void {
    // TODO: Probably not necessary to compute the target of each attestation since it should be the same
    const target = getTargetFromAttestationSerialized(item.msg.data);
    this.knownBlockRootQueuesBySlot.add(item, slot, target);

    // Always accept new attestations, but prune oldest by batches
    if (this.knownBlockRootQueuesBySlot.size > MAX_ITEMS_CACHE_KNOWN_BLOCK) {
      // Prune known block attestations, from oldest slot first
      for (let slot = this.currentSlot - MAX_SLOTS_CACHE_KNOWN_BLOCK; slot < this.currentSlot; slot++) {
        for (const _ of this.knownBlockRootQueuesBySlot.consumeBySlot(slot)) {
          // Drop

          if (this.knownBlockRootQueuesBySlot.size <= MAX_ITEMS_CACHE_KNOWN_BLOCK) {
            return;
          }
        }
      }
    }
  }
}

export class AttestationQueueUnknownBlock<T> {
  private itemCount = 0;

  // Consider converting into a ring array
  private readonly itemsByBlockRootBySlot = new MapDef<AttestationSlot, MapDef<BlockRootHex, T[]>>(
    () => new MapDef(() => [])
  );

  get size(): number {
    return this.itemCount;
  }

  add(item: T, slot: Slot, blockRoot: BlockRootHex): void {
    this.itemsByBlockRootBySlot.getOrDefault(slot).getOrDefault(blockRoot).push(item);
    this.itemCount++;
  }

  pruneBySlot(slot: Slot): void {
    const itemsByBlockRoot = this.itemsByBlockRootBySlot.get(slot);
    if (itemsByBlockRoot) {
      for (const items of itemsByBlockRoot.values()) {
        this.itemCount -= items.length;
      }
      this.itemsByBlockRootBySlot.delete(slot);
    }
  }

  *consumeByBlockRoot(blockRoot: BlockRootHex): Iterable<{slot: Slot; items: T[]}> {
    for (const [slot, itemsByBlockRoot] of this.itemsByBlockRootBySlot.entries()) {
      const items = itemsByBlockRoot.get(blockRoot);
      if (items) {
        this.itemCount -= items.length;
        itemsByBlockRoot.delete(blockRoot);

        // Clean empty datastructures
        if (itemsByBlockRoot.size === 0) {
          this.itemsByBlockRootBySlot.delete(slot);
        }

        yield {slot, items};
      }
    }
  }
}

export class AttestationQueueKnownBlock<T> {
  private itemCount = 0;

  // TODO: Convert into a ring array of size MAX_SLOTS_CACHE_KNOWN_BLOCK
  private readonly batchesByTargetBySlot = new MapDef<AttestationSlot, MapDef<TargetHex, AttestationBatcher<T>>>(
    () => new MapDef(() => new AttestationBatcher(this.batchSize))
  );

  constructor(private readonly batchSize: number) {}

  get size(): number {
    return this.itemCount;
  }

  add(item: T, slot: Slot, target: TargetHex): void {
    // Add attestations such that there's not a batch bigger than ATTESTATION_BATCH_SIZE
    this.batchesByTargetBySlot.getOrDefault(slot).getOrDefault(target).add(item);

    this.itemCount++;

    // Prune here? Yes
  }

  *consumeBySlot(slot: Slot): Iterable<{target: TargetHex; items: T[]}> {
    const batchesByTarget = this.batchesByTargetBySlot.get(slot);
    if (batchesByTarget) {
      for (const [target, batches] of batchesByTarget) {
        for (const batch of batches.consume()) {
          // TODO: Should not drop all, but a part. However mutating an array continuously causes performance
          // issues. This is why we use a LinkedList now in our queues.
          this.itemCount -= batch.length;

          // Clean empty datastructures
          if (batches.size === 0) {
            batchesByTarget.delete(target);
          }

          if (batchesByTarget.size === 0) {
            this.batchesByTargetBySlot.delete(slot);
          }

          yield {target, items: batch};
        }
      }
    }
  }
}

export class AttestationBatcher<T> {
  private batches = new Set<T[]>();

  constructor(private readonly batchSize: number) {}

  get size(): number {
    return this.batches.size;
  }

  add(item: T): void {
    // Add attestations such that there's not a batch bigger than ATTESTATION_BATCH_SIZE
    for (const batch of this.batches) {
      if (batch.length < this.batchSize) {
        batch.push(item);
        return;
      }
    }

    this.batches.add([item]);
  }

  *consume(): Iterable<T[]> {
    for (const batch of this.batches.values()) {
      this.batches.delete(batch);
      yield batch;
    }
  }
}
