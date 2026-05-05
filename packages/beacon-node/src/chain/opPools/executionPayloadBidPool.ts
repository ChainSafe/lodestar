import {Slot, gloas} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";
import {pruneBySlot} from "./utils.js";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

type BlockRootHex = string;
type BlockHashHex = string;

/**
 * Store the best signed execution payload bid per slot / (parent block root, parent block hash).
 */
export class ExecutionPayloadBidPool {
  private readonly bidByParentHashByParentRootBySlot = new MapDef<
    Slot,
    MapDef<BlockRootHex, Map<BlockHashHex, gloas.SignedExecutionPayloadBid>>
  >(() => new MapDef<BlockRootHex, Map<BlockHashHex, gloas.SignedExecutionPayloadBid>>(() => new Map()));
  private lowestPermissibleSlot = 0;

  get size(): number {
    let count = 0;
    for (const byParentRoot of this.bidByParentHashByParentRootBySlot.values()) {
      for (const byParentHash of byParentRoot.values()) {
        count += byParentHash.size;
      }
    }
    return count;
  }

  add(signedBid: gloas.SignedExecutionPayloadBid): InsertOutcome {
    const {slot, parentBlockRoot, parentBlockHash, value} = signedBid.message;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const parentRootHex = toRootHex(parentBlockRoot);
    const parentHashHex = toRootHex(parentBlockHash);
    const bidByParentHash = this.bidByParentHashByParentRootBySlot.getOrDefault(slot).getOrDefault(parentRootHex);
    const existing = bidByParentHash.get(parentHashHex);

    if (existing) {
      const existingValue = existing.message.value;
      const newValue = value;
      if (newValue > existingValue) {
        bidByParentHash.set(parentHashHex, signedBid);
        return InsertOutcome.NewData;
      }
      return newValue === existingValue ? InsertOutcome.AlreadyKnown : InsertOutcome.NotBetterThan;
    }

    bidByParentHash.set(parentHashHex, signedBid);
    return InsertOutcome.NewData;
  }

  /**
   * Return the highest-value signed bid matching slot, parent block hash, and parent block root.
   * Used for gossip validation and block production.
   */
  getBestBid(
    slot: Slot,
    parentBlockHash: BlockHashHex | null,
    parentBlockRoot: BlockRootHex
  ): gloas.SignedExecutionPayloadBid | null {
    if (parentBlockHash === null) return null;
    const bidByParentHash = this.bidByParentHashByParentRootBySlot.get(slot)?.get(parentBlockRoot);
    return bidByParentHash?.get(parentBlockHash) ?? null;
  }

  prune(clockSlot: Slot): void {
    this.lowestPermissibleSlot = pruneBySlot(this.bidByParentHashByParentRootBySlot, clockSlot, SLOTS_RETAINED);
  }
}
