import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {ForkName, GENESIS_EPOCH, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {DataTransformSnappy, msgIdToStrFn} from "../../../../src/network/gossip/encoding.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {GossipTopicCache, stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";

describe("network / gossip / encoding / msgIdToStrFn", () => {
  it("converts a valid 20-byte msgId to a 0x-prefixed hex string", () => {
    const msgId = new Uint8Array(20).fill(0x11);
    expect(msgIdToStrFn(msgId)).toBe(`0x${"11".repeat(20)}`);
  });

  it("throws on an overlong (>20-byte) msgId instead of a RangeError", () => {
    const msgId = new Uint8Array(21).fill(0x11);
    expect(() => msgIdToStrFn(msgId)).toThrow("Expect msgId to be 20 bytes, got 21");
  });

  it("throws on short msgIds and does not alias stale bytes from a previous conversion", () => {
    // Seed the shared buffer with a full 20-byte ID, as a remote peer would.
    const fullId = new Uint8Array(20).fill(0xaa);
    expect(msgIdToStrFn(fullId)).toBe(`0x${"aa".repeat(20)}`);

    // Short / empty IDs must reject rather than return the previous full ID.
    expect(() => msgIdToStrFn(new Uint8Array(1).fill(0x11))).toThrow("Expect msgId to be 20 bytes, got 1");
    expect(() => msgIdToStrFn(new Uint8Array(0))).toThrow("Expect msgId to be 20 bytes, got 0");
  });
});

describe("network / gossip / encoding / DataTransformSnappy", () => {
  const config = createBeaconConfig(chainConfig, ZERO_HASH);
  const topic = {
    type: GossipType.voluntary_exit,
    boundary: {fork: ForkName.phase0, epoch: GENESIS_EPOCH},
  } as const;
  const topicStr = stringifyGossipTopic(config, topic);
  const transform = new DataTransformSnappy(new GossipTopicCache(config), config.MAX_PAYLOAD_SIZE, null);

  it.each([
    {literal: "f00041", length: 1},
    {literal: "f0014141", length: 2},
    {literal: "f4000041", length: 1},
  ])("decodes a gossip message ending in short extended literal $literal", ({literal, length}) => {
    const exit = ssz.phase0.SignedVoluntaryExit.defaultValue();
    exit.signature.fill(0x41);
    const data = ssz.phase0.SignedVoluntaryExit.serialize(exit);
    const prefix = data.subarray(0, data.length - length);
    const compressed = new Uint8Array([
      data.length,
      0xf0,
      prefix.length - 1,
      ...prefix,
      ...Buffer.from(literal, "hex"),
    ]);

    const decoded = new Uint8Array(transform.inboundTransform(topicStr, compressed));
    expect(decoded).toEqual(data);
    expect(ssz.phase0.SignedVoluntaryExit.deserialize(decoded)).toEqual(exit);
  });
});
