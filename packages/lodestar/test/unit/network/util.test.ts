import {Status, Goodbye, SignedBeaconBlock} from "@chainsafe/eth2.0-types";
import crypto from "crypto";
import {assert, expect} from "chai";
import {describe, it} from "mocha";
import { encodeResponseChunk, decodeResponseChunk } from "../../../src/network";
import {config} from "@chainsafe/eth2.0-config/lib/presets/mainnet";
import { Method } from "../../../src/constants";
import { generateEmptySignedBlock } from "../../utils/block";


describe("Encode/decode network request/response domain", () => {
  it("should encode decode Status message correctly", () => {
    const status: Status = {
      headForkVersion: crypto.randomBytes(4),
      finalizedRoot: crypto.randomBytes(32),
      finalizedEpoch: 2,
      headRoot: crypto.randomBytes(32),
      headSlot: 20,
    };
    const chunk = encodeResponseChunk(config, Method.Status, {output: status});
    const response = decodeResponseChunk(config, Method.Status, chunk);
    assert.deepEqual(status, response.output);
  });

  it("should encode decode Goodbye message correctly", () => {
    const goodbye: Goodbye = 1n;
    const chunk = encodeResponseChunk(config, Method.Goodbye, {output: goodbye});
    const response = decodeResponseChunk(config, Method.Goodbye, chunk);
    expect(response.output).to.be.equal(goodbye);
  });

  it("should encode decode blocks message correctly", () => {
    const block = generateEmptySignedBlock();
    block.message.slot = 2020;
    const chunk = encodeResponseChunk(config, Method.BeaconBlocksByRange, {output: block});
    const response = decodeResponseChunk(config, Method.BeaconBlocksByRange, chunk);
    expect(response.output).to.be.deep.equal(block);
  });
});
