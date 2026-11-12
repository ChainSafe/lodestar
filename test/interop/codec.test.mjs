import assert from "node:assert/strict";
import {test} from "node:test";
import {MAX, encodePayload, messageId, payload, rangeRequest, readPayload, summary} from "./codec.mjs";

test("independent literal IDs and fragmented SSZ-snappy", async () => {
  const topic = "/eth2/01000000/beacon_block/ssz_snappy";
  assert.equal(
    messageId(topic, Buffer.from("hello"), true, true).toString("hex"),
    "79d62a59d0e47597aeb73cb85ba034c3f67f90e8"
  );
  assert.equal(messageId(topic, Buffer.from("hello")).toString("hex"), "e79e947290cd1ce340628caac5541294e6702329");
  assert.equal(messageId(topic, Buffer.from([255]), false).toString("hex"), "a4836ac28360e4a1514db96802f612887409b735");
  assert.equal(
    messageId(topic.replace("beacon_block", "voluntary_exit"), Buffer.from("hello")).toString("hex"),
    "ece38723d0a2c13e368a1f88a9eb881f68145a30"
  );
  for (const size of [0, 8, 65537, MAX]) {
    const input = payload(size);
    for (const compressed of [false, true]) {
      const wire = encodePayload(input, compressed);
      async function* fragments() {
        for (let at = 0; at < wire.length; at += 997) yield wire.subarray(at, at + 997);
      }
      assert.deepEqual(summary((await readPayload(fragments())).bytes), summary(input));
    }
  }
});

test("blocks by range encodes the named uint64 request fields", () => {
  assert.equal(rangeRequest().toString("hex"), "000000000000000001000000000000000100000000000000");
});
