import {describe, expect, it} from "vitest";
import {ForkName} from "@lodestar/params";
import {toRootHex} from "@lodestar/utils";
import {toHeaderChainElement} from "../../../../src/sync/target/headerChain.js";
import {config, generateBlock} from "../../../utils/blocksAndData.js";

describe("toHeaderChainElement", () => {
  it("extracts gloas header fields including bid blockHash/parentBlockHash/blobCount", () => {
    const {block, blockRoot} = generateBlock({forkName: ForkName.gloas});
    const el = toHeaderChainElement(config, block, toRootHex(blockRoot));
    const bid = (block.message.body as any).signedExecutionPayloadBid.message;
    expect(el.root).toBe(toRootHex(blockRoot));
    expect(el.parentRoot).toBe(toRootHex(block.message.parentRoot));
    expect(el.slot).toBe(block.message.slot);
    expect(el.blockHash).toBe(toRootHex(bid.blockHash));
    expect(el.parentBlockHash).toBe(toRootHex(bid.parentBlockHash));
    expect(el.blobCount).toBe(bid.blobKzgCommitments.length);
  });

  it("extracts pre-gloas (fulu) header fields from the inline execution payload", () => {
    const {block, blockRoot} = generateBlock({forkName: ForkName.fulu});
    const el = toHeaderChainElement(config, block, toRootHex(blockRoot));
    const body = block.message.body as any;
    expect(el.root).toBe(toRootHex(blockRoot));
    expect(el.parentRoot).toBe(toRootHex(block.message.parentRoot));
    expect(el.slot).toBe(block.message.slot);
    expect(el.blockHash).toBe(toRootHex(body.executionPayload.blockHash));
    expect(el.parentBlockHash).toBe(toRootHex(body.executionPayload.parentHash));
    expect(el.blobCount).toBe(body.blobKzgCommitments.length);
  });
});
