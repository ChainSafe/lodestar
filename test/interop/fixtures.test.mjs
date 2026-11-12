import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {test} from "node:test";
import {RPC} from "@libp2p/gossipsub/message";
import {encode} from "it-length-prefixed";
import {compressSync} from "snappy";
import {TOPIC, encodePayload, prefix} from "./codec.mjs";

test("independent public codecs reproduce Zig receive-boundary fixtures", async () => {
  const bodies = [
    Buffer.from(Array.from({length: 64}, (_, i) => i)),
    Buffer.from(Array.from({length: 64}, (_, i) => 255 - i)),
  ];
  const rpc = RPC.encode({
    messages: bodies.map((bytes) => ({data: compressSync(bytes), topic: TOPIC})),
    subscriptions: [],
  });
  const framed = Buffer.from(encode.single(rpc).subarray());
  assert(framed[0] & 128);
  assert.deepEqual(
    framed,
    await readFile(new URL("../../src/network/gossipsub/testdata/independent-two.rpc", import.meta.url))
  );
  const bytes = Buffer.from(Array.from({length: 130}, (_, i) => i));
  const identifier = Buffer.from("ff060000734e61507059", "hex");
  const response = Buffer.concat([
    Buffer.from([0, 1, 0, 0, 0]),
    prefix(bytes.length),
    identifier,
    encodePayload(bytes.subarray(0, 65), false).subarray(11),
    encodePayload(bytes.subarray(65), false).subarray(11),
  ]);
  assert.deepEqual(
    response,
    await readFile(new URL("../../src/network/reqresp/testdata/independent-two-frames.bin", import.meta.url))
  );
});
