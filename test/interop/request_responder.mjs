import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {boundedLines} from "./bounded_lines.mjs";
import {encodePayload, messageId, payload, readPayload, sendFragments, summary} from "./codec.mjs";
import {readEmptyRequest} from "./control_handler.mjs";
import {uint64} from "./control_wire.mjs";
import {testChain} from "./network_chain.mjs";
import {stockPackages} from "./stock_packages.mjs";

const forkContexts = testChain.forkBoundariesAscendingEpochOrder
  .filter((boundary, index, all) => boundary.epoch !== Infinity && boundary.epoch !== all[index + 1]?.epoch)
  .map((boundary) => ({
    digest: Buffer.from(testChain.forkBoundary2ForkDigest(boundary)).toString("hex"),
    fork: boundary.fork,
  }));
const {load, version, responseDecoder} = stockPackages(process.argv[2]);
const {createLibp2p} = await load("libp2p");
const {quic} = await load("@chainsafe/libp2p-quic");
const {privateKeyFromRaw} = await load("@libp2p/crypto/keys");
const {identify} = await load("@libp2p/identify");
const {multiaddr} = await load("@multiformats/multiaddr");
const {gossipsub, StrictNoSign} = await load("@libp2p/gossipsub");
const {compressSync, uncompressSync} = await load("snappy");
const gossipMode = process.argv[4] === "gossip";
const gossipMessages = [];
const gossipTopics = new Set();
const gossipService = gossipsub({
  allowPublishToZeroTopicPeers: false,
  dataTransform: {
    inboundTransform: (_topic, data) => uncompressSync(data),
    outboundTransform: (_topic, data) => compressSync(data),
  },
  floodPublish: true,
  globalSignaturePolicy: StrictNoSign,
  msgIdFn: (message) => messageId(message.topic, message.data),
});
const secret = new Uint8Array(32);
secret[31] = 62;
const blockProtocol = "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy";
let scenario = {count: 2, digest: Buffer.from(forkContexts[0].digest, "hex"), kind: "chunks", length: 4000};
let requests = 0;
let active = 0;
let lastRequest = "";
const held = new Set();
const control = {ping: 0, status: 0};
const metadataSequence = 1n;
const node = await createLibp2p({
  addresses: {listen: ["/ip4/127.0.0.1/udp/0/quic-v1"]},
  connectionGater: {denyDialMultiaddr: async (address) => !address.toString().startsWith("/ip4/127.0.0.1/")},
  privateKey: privateKeyFromRaw(secret),
  services: {identify: identify({runOnConnectionOpen: false}), pubsub: gossipService},
  start: false,
  transports: [quic()],
});
const status = Buffer.alloc(84);
status.set(scenario.digest);
status.writeBigUInt64LE(100n, 76);
async function respondControl(stream) {
  try {
    const protocol = stream.protocol;
    const metadata = protocol.includes("/metadata/");
    if (metadata) await readEmptyRequest(stream);
    else await readPayload(stream);
    let bytes;
    if (protocol.includes("/status/")) {
      control.status++;
      bytes = status;
    } else if (protocol.includes("/ping/")) {
      control.ping++;
      bytes = uint64(metadataSequence);
    } else if (protocol.includes("/goodbye/")) {
      bytes = uint64(1n);
    } else if (protocol.includes("/metadata/3/")) {
      bytes = Buffer.alloc(25);
      bytes.writeBigUInt64LE(metadataSequence);
      bytes.writeBigUInt64LE(1n, 17);
    } else if (metadata) {
      bytes = Buffer.alloc(17);
      bytes.writeBigUInt64LE(metadataSequence);
    } else throw Error("unknown control protocol");
    await sendFragments(stream, Buffer.concat([Buffer.from([0]), encodePayload(bytes)]), AbortSignal.timeout(5000));
    await stream.close({signal: AbortSignal.timeout(5000)});
  } catch (error) {
    stream.abort(error);
  }
}
for (const method of ["status/1", "ping/1", "goodbye/1", "metadata/2", "metadata/3"]) {
  await node.handle(`/eth2/beacon_chain/req/${method}/ssz_snappy`, respondControl, {
    maxInboundStreams: 8,
    maxOutboundStreams: 8,
  });
}
await node.handle(
  blockProtocol,
  async (stream) => {
    active++;
    try {
      assert(active <= 8 && ++requests <= 128);
      const request = await readPayload(stream);
      lastRequest = request.bytes.toString("hex");
      assert(request.bytes.length <= 4096);
      const selected = scenario;
      if (selected.kind === "hold") {
        assert(held.size < 8);
        held.add(stream);
        const timer = setTimeout(() => {
          held.delete(stream);
          stream.abort(Error("fixture hold bound"));
        }, 15000);
        timer.unref();
        stream.addEventListener(
          "close",
          () => {
            clearTimeout(timer);
            held.delete(stream);
          },
          {once: true}
        );
        return;
      }
      if (selected.kind === "peer-error") {
        await sendFragments(
          stream,
          Buffer.concat([Buffer.from([3]), encodePayload(Buffer.from([0, 0xff, 0xc3, 0x28, 0x80]))]),
          AbortSignal.timeout(5000)
        );
      } else if (selected.kind !== "empty") {
        for (let i = 0; i < selected.count; i++) {
          const bytes = selected.kind === "hoodi" ? await readFile(process.argv[3]) : payload(selected.length, 71 + i);
          await sendFragments(
            stream,
            Buffer.concat([Buffer.from([0]), selected.digest, encodePayload(bytes)]),
            AbortSignal.timeout(10000)
          );
        }
      }
      await stream.close({signal: AbortSignal.timeout(5000)});
    } catch (error) {
      stream.abort(error);
    } finally {
      active--;
    }
  },
  {maxInboundStreams: 8, maxOutboundStreams: 8}
);
if (gossipMode)
  node.services.pubsub.addEventListener("message", (event) => {
    assert(gossipMessages.length < 128);
    gossipMessages.push({
      ...summary(event.detail.data),
      messageId: messageId(event.detail.topic, event.detail.data).toString("hex"),
      topic: event.detail.topic,
    });
  });
await node.start();
let commands = 0;
for await (const line of boundedLines(process.stdin)) {
  assert(++commands <= 512);
  const command = JSON.parse(line);
  try {
    let response = {};
    if (command.op === "ready")
      response = {
        address: node.getMultiaddrs()[0].toString(),
        peer: Buffer.from(node.peerId.toMultihash().bytes).toString("hex"),
        protocols: node.getProtocols(),
        versions: {libp2p: await version("libp2p"), quic: await version("@chainsafe/libp2p-quic")},
      };
    else if (command.op === "gossipSubscribe") {
      assert(gossipMode && /^\/eth2\/[0-9a-f]{8}\/beacon_block\/ssz_snappy$/.test(command.topic));
      assert(gossipTopics.size < 4);
      gossipTopics.add(command.topic);
      node.services.pubsub.subscribe(command.topic);
    } else if (command.op === "gossipPublish") {
      assert(gossipMode && gossipTopics.has(command.topic));
      assert(Number.isInteger(command.length) && command.length >= 10 && command.length <= 10 * 1024 * 1024);
      const data = command.hoodi ? await readFile(process.argv[3]) : payload(command.length, command.seed ?? 71);
      if (command.slot !== undefined) {
        assert(Number.isSafeInteger(command.slot) && command.slot >= 0 && data.length >= 108);
        data.writeBigUInt64LE(BigInt(command.slot), 100);
      }
      const result = await node.services.pubsub.publish(command.topic, data);
      response = {
        ...summary(data),
        messageId: messageId(command.topic, data).toString("hex"),
        recipients: result.recipients.length,
      };
    } else if (command.op === "gossipStats") {
      assert(gossipMode);
      response = {
        messages: gossipMessages,
        subscribers: [...gossipTopics].map((topic) => ({
          count: node.services.pubsub.getSubscribers(topic).length,
          topic,
        })),
      };
    } else if (command.op === "scenario") {
      const candidate = {
        count: command.count ?? 2,
        digest: Buffer.from(command.digest ?? forkContexts[0].digest, "hex"),
        kind: command.scenario,
        length: command.length ?? 4000,
      };
      assert(["chunks", "empty", "peer-error", "hold", "hoodi"].includes(candidate.kind));
      assert(Number.isInteger(candidate.length) && candidate.length >= 0 && candidate.length <= 10 * 1024 * 1024);
      assert(Number.isInteger(candidate.count) && candidate.count >= 0 && candidate.count <= 4);
      assert.equal(candidate.digest.length, 4);
      scenario = candidate;
    } else if (command.op === "stats") response = {active, control, lastRequest, requests};
    else if (command.op === "ping") {
      command.address ??= multiaddr(Buffer.from(command.addressBytes, "hex")).toString();
      assert(/^\/ip4\/127\.0\.0\.1\/udp\/[0-9]+\/quic-v1\/p2p\/[A-Za-z0-9]+$/.test(command.address));
      const stream = await node.dialProtocol(multiaddr(command.address), "/eth2/beacon_chain/req/ping/1/ssz_snappy", {
        signal: AbortSignal.timeout(5000),
      });
      const ping = Buffer.alloc(8);
      ping.writeBigUInt64LE(metadataSequence);
      await sendFragments(stream, encodePayload(ping), AbortSignal.timeout(5000));
      await stream.close({signal: AbortSignal.timeout(5000)});
      const reply = await readPayload(stream, true);
      assert.equal(reply.result, 0);
      response = {length: reply.bytes.length};
    } else if (command.op === "request") {
      command.address ??= multiaddr(Buffer.from(command.addressBytes, "hex")).toString();
      assert(/^\/ip4\/127\.0\.0\.1\/udp\/[0-9]+\/quic-v1\/p2p\/[A-Za-z0-9]+$/.test(command.address));
      const {responseDecode} = await responseDecoder();
      const stream = await node.dialProtocol(multiaddr(command.address), blockProtocol, {
        signal: AbortSignal.timeout(5000),
      });
      try {
        const input = Buffer.from(command.data ?? "00".repeat(64), "hex");
        assert(input.length <= 4096);
        await sendFragments(stream, encodePayload(input), AbortSignal.timeout(5000));
        await stream.close({signal: AbortSignal.timeout(5000)});
        const contexts = [];
        const protocol = {
          contextBytes: {
            config: {
              forkDigest2ForkBoundary(bytes) {
                const digest = Buffer.from(bytes).toString("hex");
                const boundary = forkContexts.find((boundary) => boundary.digest === digest);
                assert(boundary);
                contexts.push(digest);
                return {fork: boundary.fork};
              },
            },
            type: 1,
          },
          encoding: "ssz_snappy",
          responseSizes: () => ({maxSize: 10 * 1024 * 1024, minSize: 1000}),
          version: 2,
        };
        const chunks = [];
        try {
          for await (const chunk of responseDecode(protocol, stream, {signal: AbortSignal.timeout(20000)})) {
            assert(chunks.length < 8);
            chunks.push({...summary(chunk.data), fork: chunk.fork});
          }
          response = {chunks, contexts};
        } catch (error) {
          if (typeof error.status !== "number") throw error;
          response = {chunks, contexts, message: error.type.errorMessage, status: error.status};
        }
      } finally {
        stream.abort(Error("fixture request finished"));
      }
    } else if (command.op === "shutdown") {
      for (const stream of held) stream.abort(Error("fixture shutdown"));
      await node.stop();
      process.stdout.write(`${JSON.stringify({id: command.id, ok: true})}\n`);
      break;
    } else throw Error("unknown command");
    process.stdout.write(`${JSON.stringify({id: command.id, ok: true, ...response})}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({error: String(error), id: command.id, ok: false})}\n`);
  }
}
await node.stop();
