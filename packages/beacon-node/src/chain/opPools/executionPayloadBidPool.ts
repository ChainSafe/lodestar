import {Slot, gloas} from "@lodestar/types";
import {MapDef, toRootHex} from "@lodestar/utils";
import {InsertOutcome} from "./types.js";
import {pruneBySlot} from "./utils.js";

/**
 * TODO GLOAS: Revisit this value and add rational for choosing it
 */
const SLOTS_RETAINED = 2;

type BlockRootHex = string;
type PayloadRootHex = string;

export type PooledExecutionPayloadBid = {
  signedBid: gloas.SignedExecutionPayloadBid;
  /** Time in milliseconds from the slot start when the bid was received */
  receivedMs: number;
};

/**
 * Store the best signed execution payload bid per slot / (parent block root, parent payload root).
 */
export class ExecutionPayloadBidPool {
  private readonly bidByParentPayloadRootByParentRootBySlot = new MapDef<
    Slot,
    MapDef<BlockRootHex, Map<PayloadRootHex, PooledExecutionPayloadBid>>
  >(() => new MapDef<BlockRootHex, Map<PayloadRootHex, PooledExecutionPayloadBid>>(() => new Map()));
  private lowestPermissibleSlot = 0;

  get size(): number {
    let count = 0;
    for (const byParentRoot of this.bidByParentPayloadRootByParentRootBySlot.values()) {
      for (const byParentPayloadRoot of byParentRoot.values()) {
        count += byParentPayloadRoot.size;
      }
    }
    return count;
  }

  add(bid: gloas.SignedExecutionPayloadBid, receivedMs: number): InsertOutcome {
    const {slot, parentBlockRoot, parentPayloadRoot, value} = bid.message;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const parentRootHex = toRootHex(parentBlockRoot);
    const parentPayloadRootHex = toRootHex(parentPayloadRoot);
    const bidByParentPayloadRoot = this.bidByParentPayloadRootByParentRootBySlot
      .getOrDefault(slot)
      .getOrDefault(parentRootHex);
    const existing = bidByParentPayloadRoot.get(parentPayloadRootHex);

    if (existing) {
      const existingValue = existing.signedBid.message.value;
      const newValue = value;
      if (newValue > existingValue) {
        bidByParentPayloadRoot.set(parentPayloadRootHex, {signedBid: bid, receivedMs});
        return InsertOutcome.NewData;
      }
      return newValue === existingValue ? InsertOutcome.AlreadyKnown : InsertOutcome.NotBetterThan;
    }

    bidByParentPayloadRoot.set(parentPayloadRootHex, {signedBid: bid, receivedMs});
    return InsertOutcome.NewData;
  }

  /**
   * Return the highest-value signed bid matching slot, parent payload root, and parent block root.
   * Used for gossip validation and block production.
   */
  getBestBid(
    slot: Slot,
    parentPayloadRoot: PayloadRootHex | null,
    parentBlockRoot: BlockRootHex
  ): PooledExecutionPayloadBid | null {
    if (parentPayloadRoot === null) return null;
    const bidByParentPayloadRoot = this.bidByParentPayloadRootByParentRootBySlot.get(slot)?.get(parentBlockRoot);
    return bidByParentPayloadRoot?.get(parentPayloadRoot) ?? null;
  }

  prune(clockSlot: Slot): void {
    this.lowestPermissibleSlot = pruneBySlot(this.bidByParentPayloadRootByParentRootBySlot, clockSlot, SLOTS_RETAINED);
  }
}
