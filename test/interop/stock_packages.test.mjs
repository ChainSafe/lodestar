import assert from "node:assert/strict";
import {test} from "node:test";
import {quic} from "@chainsafe/libp2p-quic";
import {multiaddr} from "@multiformats/multiaddr";
import {createLibp2p} from "libp2p";
import {Child} from "./child.mjs";
import {encodePayload, payload, readPayload, sendFragments, summary} from "./codec.mjs";
import {stockPackages} from "./stock_packages.mjs";

test("installed stock fixture resolves pinned peers and the Lodestar response decoder", async () => {
  const packages = stockPackages("installed");
  assert.equal(await packages.version("@lodestar/reqresp"), "1.46.0");
  assert.equal(await packages.version("libp2p"), "3.3.10");
  for (const [name, exported] of [
    ["libp2p", "createLibp2p"],
    ["@chainsafe/libp2p-quic", "quic"],
    ["@libp2p/crypto/keys", "privateKeyFromRaw"],
    ["@libp2p/crypto/keys", "publicKeyFromProtobuf"],
    ["@libp2p/identify", "identify"],
    ["@libp2p/peer-id", "peerIdFromPublicKey"],
    ["@libp2p/gossipsub", "gossipsub"],
    ["@multiformats/multiaddr", "multiaddr"],
    ["snappy", "compressSync"],
    ["snappy", "uncompressSync"],
  ]) {
    assert.equal(typeof (await packages.load(name))[exported], "function", `${name} ${exported}`);
  }
  assert.equal((await packages.load("@libp2p/gossipsub")).StrictNoSign, "StrictNoSign");
  assert.equal(typeof (await packages.responseDecoder()).responseDecode, "function");
});

test("rejected stock scenarios preserve subsequent response bytes, context and count", async () => {
  const peer = new Child("stock-scenario", process.execPath, ["test/interop/request_responder.mjs", "installed"]);
  let client;
  try {
    client = await createLibp2p({transports: [quic()]});
    const ready = await peer.command("ready");
    const expected = {count: 2, digest: "05060708", length: 2048, scenario: "chunks"};
    await peer.command("scenario", expected);
    const {responseDecode} = await stockPackages("installed").responseDecoder();
    for (const rejected of [
      {count: 0, length: -1, scenario: "empty"},
      {count: 5, length: 1024, scenario: "chunks"},
      {count: 1.5, scenario: "peer-error"},
      {count: 1, digest: "0102", scenario: "chunks"},
    ]) {
      await assert.rejects(peer.command("scenario", rejected), /AssertionError/);
      const signal = AbortSignal.timeout(5000);
      const stream = await client.dialProtocol(
        multiaddr(ready.address),
        "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy",
        {signal}
      );
      const abort = () => stream.abort(signal.reason);
      signal.addEventListener("abort", abort, {once: true});
      try {
        await sendFragments(stream, encodePayload(Buffer.alloc(32)), signal);
        await stream.close({signal});
        const chunks = [];
        const protocol = {
          contextBytes: {
            config: {
              forkDigest2ForkBoundary(bytes) {
                assert.equal(Buffer.from(bytes).toString("hex"), expected.digest);
                return {fork: "deneb"};
              },
            },
            type: 1,
          },
          encoding: "ssz_snappy",
          responseSizes: () => ({maxSize: expected.length, minSize: expected.length}),
          version: 2,
        };
        for await (const chunk of responseDecode(protocol, stream, {signal})) {
          assert(chunks.length < expected.count);
          chunks.push(summary(chunk.data));
        }
        assert.deepEqual(chunks, [summary(payload(expected.length, 71)), summary(payload(expected.length, 72))]);
      } finally {
        signal.removeEventListener("abort", abort);
        stream.abort(Error("fixture scenario check finished"));
      }
    }
  } finally {
    await Promise.allSettled([client?.stop(), peer.stop()]).then((results) => {
      for (const result of results) if (result.status === "rejected") throw result.reason;
    });
  }
});

for (const mode of ["", "gossip"]) {
  test(`installed stock fixture starts and stops its ${mode || "request"} responder`, async () => {
    const peer = new Child(`stock-${mode || "request"}`, process.execPath, [
      "test/interop/request_responder.mjs",
      "installed",
      "",
      mode,
    ]);
    try {
      const ready = await peer.command("ready");
      assert.deepEqual(ready.versions, {libp2p: "3.3.10", quic: "2.1.3"});
      assert(ready.protocols.includes("/meshsub/1.2.0"), "ordinary managed peers must support gossip");
      const client = await createLibp2p({transports: [quic()]});
      try {
        for (const [method, length] of [
          ["metadata/2", 17],
          ["metadata/3", 25],
          ["ping/1", 8],
          ["goodbye/1", 8],
        ]) {
          const signal = AbortSignal.timeout(5000);
          const stream = await client.dialProtocol(
            multiaddr(ready.address),
            `/eth2/beacon_chain/req/${method}/ssz_snappy`,
            {signal}
          );
          const abort = () => stream.abort(signal.reason);
          signal.addEventListener("abort", abort, {once: true});
          try {
            if (method === "ping/1" || method === "goodbye/1") {
              const request = Buffer.alloc(8);
              request.writeBigUInt64LE(99n);
              await sendFragments(stream, encodePayload(request), signal);
            }
            await stream.close({signal});
            const response = await readPayload(stream, true);
            const expected = Buffer.alloc(length);
            expected.writeBigUInt64LE(1n);
            if (method === "metadata/3") expected.writeBigUInt64LE(1n, 17);
            assert.equal(response.result, 0);
            assert.deepEqual(response.bytes, expected, method);
          } finally {
            signal.removeEventListener("abort", abort);
            stream.abort(Error("fixture control check finished"));
          }
        }
      } finally {
        await client.stop();
      }
    } finally {
      await peer.stop();
    }
  });
}
