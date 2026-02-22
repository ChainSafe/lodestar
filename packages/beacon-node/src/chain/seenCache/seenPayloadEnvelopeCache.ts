import type {CheckpointWithHex} from "@lodestar/fork-choice";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import type {RootHex} from "@lodestar/types";
import type {Metrics} from "../../metrics/metrics.js";
import {type BidInfo, PayloadEnvelopeInput} from "../blocks/payloadEnvelopeInput.js";

const MAX_PAYLOAD_ENVELOPE_CACHE_SIZE = 64;

/**
 * Cache for PayloadEnvelopeInput instances, keyed by block root.
 * Separate from SeenBlockInput — this is the envelope pipeline's cache.
 */
export class SeenPayloadEnvelopeCache {
  private cache = new Map<RootHex, PayloadEnvelopeInput>();

  constructor(metrics: Metrics | null) {
    void metrics;
  }

  /**
   * Create a PayloadEnvelopeInput from bid info and store it.
   * Called from the block gossip handler after validation succeeds.
   */
  createFromBid(bid: BidInfo): PayloadEnvelopeInput {
    const existing = this.cache.get(bid.blockRootHex);
    if (existing) {
      return existing;
    }
    const input = PayloadEnvelopeInput.createFromBid(bid);
    this.cache.set(bid.blockRootHex, input);
    this.pruneToMaxSize();
    return input;
  }

  get(blockRootHex: RootHex): PayloadEnvelopeInput | undefined {
    return this.cache.get(blockRootHex);
  }

  has(blockRootHex: RootHex): boolean {
    return this.cache.has(blockRootHex);
  }

  prune(blockRootHex: RootHex): void {
    this.cache.delete(blockRootHex);
  }

  onFinalized(checkpoint: CheckpointWithHex): void {
    const cutoffSlot = computeStartSlotAtEpoch(checkpoint.epoch);
    for (const [rootHex, input] of this.cache) {
      if (input.slot < cutoffSlot) {
        this.cache.delete(rootHex);
      }
    }
  }

  get size(): number {
    return this.cache.size;
  }

  private pruneToMaxSize(): void {
    if (this.cache.size <= MAX_PAYLOAD_ENVELOPE_CACHE_SIZE) return;
    // Evict oldest by slot
    const sorted = [...this.cache.entries()].sort((a, b) => a[1].slot - b[1].slot);
    let toDelete = this.cache.size - MAX_PAYLOAD_ENVELOPE_CACHE_SIZE;
    for (const [rootHex] of sorted) {
      if (toDelete <= 0) break;
      this.cache.delete(rootHex);
      toDelete--;
    }
  }
}
