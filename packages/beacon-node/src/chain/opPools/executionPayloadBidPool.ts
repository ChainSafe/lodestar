import {Slot, gloas} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";
import {pruneBySlot} from "./utils.js";

const SLOTS_RETAINED: Slot = 2;

type BlockRootHex = string;
type BlockHashHex = string;

/**
 * Store the best execution payload bid per slot / (parent block root, parent block hash).
 */
export class ExecutionPayloadBidPool {
  private readonly bidByParentHashByParentRootBySlot = new MapDef<
    Slot,
    MapDef<string, Map<string, gloas.ExecutionPayloadBid>>
  >(() => new MapDef<string, Map<string, gloas.ExecutionPayloadBid>>(() => new Map()));
  private lowestPermissibleSlot = 0;

  add(bid: gloas.ExecutionPayloadBid): InsertOutcome {
    const {slot, parentBlockRoot, parentBlockHash, value} = bid;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const parentRootHex = toRootHex(parentBlockRoot);
    const parentHashHex = toRootHex(parentBlockHash);
    const bidByParentHash = this.bidByParentHashByParentRootBySlot.getOrDefault(slot).getOrDefault(parentRootHex);
    const existing = bidByParentHash.get(parentHashHex);

    if (existing) {
      const existingValue = BigInt(existing.value);
      const newValue = BigInt(value);
      if (newValue > existingValue) {
        bidByParentHash.set(parentHashHex, bid);
        return InsertOutcome.NewData;
      }
      return newValue === existingValue ? InsertOutcome.AlreadyKnown : InsertOutcome.NotBetterThan;
    }

    bidByParentHash.set(parentHashHex, bid);
    return InsertOutcome.NewData;
  }

  /**
   * Return the highest-value bid matching slot, parent block root, and parent block hash.
   * Used for gossip validation and block production.
   */
  getBestBid(
    parentBlockRoot: BlockRootHex,
    parentBlockHash: BlockHashHex,
    slot: Slot
  ): gloas.ExecutionPayloadBid | null {
    const bidByParentHash = this.bidByParentHashByParentRootBySlot.get(slot)?.get(parentBlockRoot);
    return bidByParentHash?.get(parentBlockHash) ?? null;
  }

  prune(clockSlot: Slot): void {
    this.lowestPermissibleSlot = pruneBySlot(this.bidByParentHashByParentRootBySlot, clockSlot, SLOTS_RETAINED);
  }
}
