import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {ExecutionPayloadBidPool} from "../../../../src/chain/opPools/executionPayloadBidPool.js";

describe("ExecutionPayloadBidPool", () => {
  const slot = 1;
  const parentBlockRoot = toRootHex(Buffer.alloc(32, 1));
  const parentBlockHash = toRootHex(Buffer.alloc(32, 2));

  function createBid(value: number): ReturnType<typeof ssz.gloas.SignedExecutionPayloadBid.defaultValue> {
    const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    bid.message.slot = slot;
    bid.message.parentBlockRoot = Buffer.alloc(32, 1);
    bid.message.parentBlockHash = Buffer.alloc(32, 2);
    bid.message.value = value;
    return bid;
  }

  it("keeps bids for proposal out of the best bid used for gossip validation", () => {
    const pool = new ExecutionPayloadBidPool();
    const bid = createBid(1);
    const proposalBid = createBid(2);
    pool.add(bid, 0);
    pool.addForProposal(proposalBid, 0);

    expect(pool.getBestBid(slot, parentBlockHash, parentBlockRoot)?.signedBid).toBe(bid);
    expect(pool.getBestBidForProposal(slot, parentBlockHash, parentBlockRoot)?.signedBid).toBe(proposalBid);

    const higherBid = createBid(3);
    pool.add(higherBid, 0);
    expect(pool.getBestBidForProposal(slot, parentBlockHash, parentBlockRoot)?.signedBid).toBe(higherBid);
  });
});
