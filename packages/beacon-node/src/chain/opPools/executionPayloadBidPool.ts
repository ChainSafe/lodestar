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

export type PooledExecutionPayloadBid = {
  signedBid: gloas.SignedExecutionPayloadBid;
  /** Time in milliseconds from the slot start when the bid was received */
  receivedMs: number;
};

type BidByParentHashByParentRootBySlot = MapDef<
  Slot,
  MapDef<BlockRootHex, Map<BlockHashHex, PooledExecutionPayloadBid>>
>;

function newBidByParentHashByParentRootBySlot(): BidByParentHashByParentRootBySlot {
  return new MapDef<Slot, MapDef<BlockRootHex, Map<BlockHashHex, PooledExecutionPayloadBid>>>(
    () => new MapDef<BlockRootHex, Map<BlockHashHex, PooledExecutionPayloadBid>>(() => new Map())
  );
}

/**
 * Store the best signed execution payload bid per slot / (parent block root, parent block hash).
 */
export class ExecutionPayloadBidPool {
  private readonly bidByParentHashByParentRootBySlot = newBidByParentHashByParentRootBySlot();
  /**
   * Bids past the builder's bid limit that a local proposer considers. They are kept apart because
   * they are not forwarded, so they must not raise the best bid used for gossip validation.
   */
  private readonly proposalBidByParentHashByParentRootBySlot = newBidByParentHashByParentRootBySlot();
  private lowestPermissibleSlot = 0;

  get size(): number {
    let count = 0;
    for (const bidsBySlot of [this.bidByParentHashByParentRootBySlot, this.proposalBidByParentHashByParentRootBySlot]) {
      for (const byParentRoot of bidsBySlot.values()) {
        for (const byParentHash of byParentRoot.values()) {
          count += byParentHash.size;
        }
      }
    }
    return count;
  }

  add(bid: gloas.SignedExecutionPayloadBid, receivedMs: number): InsertOutcome {
    return this.insert(this.bidByParentHashByParentRootBySlot, bid, receivedMs);
  }

  addForProposal(bid: gloas.SignedExecutionPayloadBid, receivedMs: number): InsertOutcome {
    return this.insert(this.proposalBidByParentHashByParentRootBySlot, bid, receivedMs);
  }

  private insert(
    bidsBySlot: BidByParentHashByParentRootBySlot,
    bid: gloas.SignedExecutionPayloadBid,
    receivedMs: number
  ): InsertOutcome {
    const {slot, parentBlockRoot, parentBlockHash, value} = bid.message;
    const lowestPermissibleSlot = this.lowestPermissibleSlot;

    if (slot < lowestPermissibleSlot) {
      return InsertOutcome.Old;
    }

    const parentRootHex = toRootHex(parentBlockRoot);
    const parentHashHex = toRootHex(parentBlockHash);
    const bidByParentHash = bidsBySlot.getOrDefault(slot).getOrDefault(parentRootHex);
    const existing = bidByParentHash.get(parentHashHex);

    if (existing) {
      const existingValue = existing.signedBid.message.value;
      const newValue = value;
      if (newValue > existingValue) {
        bidByParentHash.set(parentHashHex, {signedBid: bid, receivedMs});
        return InsertOutcome.NewData;
      }
      return newValue === existingValue ? InsertOutcome.AlreadyKnown : InsertOutcome.NotBetterThan;
    }

    bidByParentHash.set(parentHashHex, {signedBid: bid, receivedMs});
    return InsertOutcome.NewData;
  }

  /**
   * Return the highest-value forwarded signed bid matching slot, parent block hash, and parent block root.
   * Used for gossip validation.
   */
  getBestBid(
    slot: Slot,
    parentBlockHash: BlockHashHex | null,
    parentBlockRoot: BlockRootHex
  ): PooledExecutionPayloadBid | null {
    if (parentBlockHash === null) return null;
    const bidByParentHash = this.bidByParentHashByParentRootBySlot.get(slot)?.get(parentBlockRoot);
    return bidByParentHash?.get(parentBlockHash) ?? null;
  }

  /**
   * Return the highest-value signed bid a local proposer can select, including bids past the builder's bid limit.
   * Used for block production.
   */
  getBestBidForProposal(
    slot: Slot,
    parentBlockHash: BlockHashHex | null,
    parentBlockRoot: BlockRootHex
  ): PooledExecutionPayloadBid | null {
    const bestBid = this.getBestBid(slot, parentBlockHash, parentBlockRoot);
    if (parentBlockHash === null) return bestBid;
    const proposalBid =
      this.proposalBidByParentHashByParentRootBySlot.get(slot)?.get(parentBlockRoot)?.get(parentBlockHash) ?? null;
    if (
      proposalBid !== null &&
      (bestBid === null || proposalBid.signedBid.message.value > bestBid.signedBid.message.value)
    ) {
      return proposalBid;
    }
    return bestBid;
  }

  prune(clockSlot: Slot): void {
    this.lowestPermissibleSlot = pruneBySlot(this.bidByParentHashByParentRootBySlot, clockSlot, SLOTS_RETAINED);
    pruneBySlot(this.proposalBidByParentHashByParentRootBySlot, clockSlot, SLOTS_RETAINED);
  }
}
