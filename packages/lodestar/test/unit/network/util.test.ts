import {Status, BeaconBlock, Goodbye} from "@chainsafe/eth2.0-types";
import crypto from "crypto";
import {assert, expect} from "chai";
import {describe, it} from "mocha";
import { encodeChunkifyResponse, decodeChunkifyResponse } from "../../../src/network";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import { Method } from "../../../src/constants";
import { generateEmptyBlock } from "../../utils/block";


describe("Encode/decode network request/response domain", () => {
  it("should encode decode Status message correctly", () => {
    const status: Status = {
      headForkVersion: crypto.randomBytes(4),
      finalizedRoot: crypto.randomBytes(32),
      finalizedEpoch: 2,
      headRoot: crypto.randomBytes(32),
      headSlot: 20,
    };
    const chunk = encodeChunkifyResponse(config, Method.Status, status);
    const newStatus = decodeChunkifyResponse(config, Method.Status, chunk);
    assert.deepEqual(JSON.stringify(status), JSON.stringify(newStatus));
  });

  it("should encode decode Goodbye message correctly", () => {
    const goodbye: Goodbye = 1n;
    const chunk = encodeChunkifyResponse(config, Method.Goodbye, goodbye);
    const newGoodbye = decodeChunkifyResponse(config, Method.Goodbye, chunk);
    expect(newGoodbye).to.be.equal(goodbye);
  });

  it("should encode decode blocks message correctly", () => {
    const blocks: BeaconBlock[] = [];
    for (let i = 0; i < 20; i++) {
      const block = generateEmptyBlock();
      block.slot = i;
      blocks.push(block);
    }
    const chunks = encodeChunkifyResponse(config, Method.BeaconBlocksByRange, blocks);
    const newBlocks = decodeChunkifyResponse(config, Method.BeaconBlocksByRange, chunks) as BeaconBlock[];
    expect(newBlocks.length).to.be.equal(blocks.length);
    for (let i = 0; i < blocks.length; i++) {
      expect(newBlocks[i]).to.be.deep.equal(blocks[i]);
    }
  });
});
