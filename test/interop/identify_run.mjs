import assert from "node:assert/strict";
import {resolve} from "node:path";
import {Child, verifyExecutable, waitFor} from "./child.mjs";
import {TOPIC, encodePayload, messageId, payload, readPayload, sendFragments, summary} from "./codec.mjs";
import {status2} from "./control_wire.mjs";
import {stockPackages} from "./stock_packages.mjs";

const hostRoot = process.argv[3];
assert(hostRoot, "pass installed or the pinned Lodestar host root as the second argument");
const {load, version} = stockPackages(hostRoot);
const packages = [
  "libp2p",
  "@libp2p/identify",
  "@libp2p/gossipsub",
  "@libp2p/crypto",
  "@libp2p/peer-id",
  "@chainsafe/libp2p-quic",
  "@multiformats/multiaddr",
  "snappy",
];
const versions = Object.fromEntries(await Promise.all(packages.map(async (name) => [name, await version(name)])));
const {createLibp2p} = await load("libp2p");
const {identify} = await load("@libp2p/identify");
const {gossipsub, StrictNoSign} = await load("@libp2p/gossipsub");
const {privateKeyFromRaw, publicKeyFromProtobuf} = await load("@libp2p/crypto/keys");
const {peerIdFromPublicKey} = await load("@libp2p/peer-id");
const {quic} = await load("@chainsafe/libp2p-quic");
const {multiaddr} = await load("@multiformats/multiaddr");
const {compressSync, uncompressSync} = await load("snappy");
const binary = await verifyExecutable(process.argv[2] ?? "zig-out/bin/network_interop_peer");
const expectedProtocols = [
  "/ipfs/id/1.0.0",
  "/meshsub/1.2.0",
  "/meshsub/1.1.0",
  ...[
    "goodbye/1",
    "ping/1",
    "metadata/3",
    "status/1",
    "status/2",
    "beacon_blocks_by_range/2",
    "beacon_blocks_by_root/2",
    "beacon_blocks_by_head/1",
    "blob_sidecars_by_range/1",
    "blob_sidecars_by_root/1",
    "data_column_sidecars_by_range/1",
    "data_column_sidecars_by_root/1",
    "light_client_bootstrap/1",
    "light_client_updates_by_range/1",
    "light_client_finality_update/1",
    "light_client_optimistic_update/1",
  ].map((method) => `/eth2/beacon_chain/req/${method}/ssz_snappy`),
].sort();

async function exercise(nativeDials) {
  const zig = new Child("identify-zig", binary, []);
  let node;
  const log = [];
  try {
    await zig.command("identifyMode");
    const secret = Buffer.alloc(32);
    secret[31] = nativeDials ? 48 : 49;
    node = await createLibp2p({
      addresses: {listen: ["/ip4/127.0.0.1/udp/0/quic-v1"]},
      connectionGater: {denyDialMultiaddr: async (address) => !address.toString().startsWith("/ip4/127.0.0.1/")},
      nodeInfo: {userAgent: "pinned-stock-identify"},
      privateKey: privateKeyFromRaw(secret),
      services: {
        identify: identify({runOnConnectionOpen: false}),
        pubsub: (components) => {
          const owner = gossipsub({
            allowPublishToZeroTopicPeers: false,
            dataTransform: {
              inboundTransform: (_topic, data) => uncompressSync(data),
              outboundTransform: (_topic, data) => compressSync(data),
            },
            floodPublish: true,
            globalSignaturePolicy: StrictNoSign,
            heartbeatInterval: 300,
            msgIdFn: (message) => messageId(message.topic, message.data, true, true),
          })(components);
          owner.protocols = ["/meshsub/1.2.0", "/meshsub/1.1.0"];
          return owner;
        },
      },
      start: false,
      transports: [quic()],
    });
    const received = [];
    node.services.pubsub.addEventListener("message", (event) => {
      assert(received.length < 8);
      received.push(summary(event.detail.data));
    });
    node.addEventListener("peer:identify", (event) => {
      assert(log.length < 16);
      log.push({
        event: "identify",
        peer: event.detail.peerId.toString(),
        protocols: [...event.detail.protocols].sort(),
      });
    });
    await node.handle(
      status2,
      async (stream) => {
        stream.abort(Error("unexpected stock Status request"));
      },
      {maxInboundStreams: 1}
    );
    await node.start();
    node.services.pubsub.subscribe(TOPIC);
    await zig.command("subscribe", {topic: TOPIC});
    const listen = await zig.command("listen");
    let connection;
    if (nativeDials) {
      await zig.command("dial", {address: node.getMultiaddrs()[0].toString()});
      await waitFor(() => node.getConnections().length === 1);
      connection = node.getConnections()[0];
    } else connection = await node.dial(multiaddr(listen.address), {signal: AbortSignal.timeout(5000)});
    await waitFor(async () => (await zig.command("snapshot")).gossipPeers === 1);
    assert.equal(node.services.pubsub.streamsOutbound.size, 0, "no topology stream before Identify");
    assert.equal(connection.streams.filter((stream) => stream.protocol?.startsWith("/meshsub/")).length, 0);
    const before = await zig.command("snapshot");
    assert.equal(before.outboundVersion, undefined, "native request set prevents incidental outbound meshsub");
    const signal = AbortSignal.timeout(5000);
    const status = Buffer.alloc(92);
    status[0] = 1;
    const stream = await connection.newStream(status2, {signal});
    await sendFragments(stream, encodePayload(status), signal);
    await stream.close({signal});
    const response = await readPayload(stream, true);
    assert.deepEqual(response.bytes, status);
    await waitFor(() => zig.events.some((event) => event.event === "statusAccepted"));
    log.push({event: "statusAccepted"});
    const remote = await node.services.identify.identify(connection, {signal: AbortSignal.timeout(5000)});
    assert(peerIdFromPublicKey(publicKeyFromProtobuf(remote.publicKey)).equals(connection.remotePeer));
    assert.equal(remote.agentVersion, "lodestar-z-identify");
    assert.equal(remote.protocolVersion, "ipfs/0.1.0");
    assert.deepEqual([...remote.protocols].sort(), expectedProtocols);
    assert.deepEqual(
      remote.listenAddrs.map((address) => address.toString()),
      [listen.address.split("/p2p/")[0]]
    );
    await waitFor(() => node.services.pubsub.streamsOutbound.has(connection.remotePeer.toString()));
    assert.equal(log.filter((entry) => entry.event === "identify").length, 1);
    const topologyStream = node.services.pubsub.streamsOutbound.get(connection.remotePeer.toString());
    assert.equal(topologyStream.protocol, "/meshsub/1.2.0");
    log.push({event: "topologyOutbound", protocol: topologyStream.protocol});
    const isolated = await zig.command("snapshot");
    assert.equal(isolated.hasInboundStream, true);
    assert.equal(isolated.outboundVersion, undefined);
    await zig.command("enableGossipRequest");
    await zig.command("identify");
    await waitFor(() => zig.events.some((event) => event.event === "identified"));
    const native = zig.events.find((event) => event.event === "identified");
    assert.equal(native.agent, "pinned-stock-identify");
    assert.equal(native.identify, true);
    assert.equal(native.meshsub, true);
    assert.equal(native.status2, true);
    await waitFor(async () => (await zig.command("snapshot")).remoteSubscriptions > 0);
    await waitFor(() => node.services.pubsub.getSubscribers(TOPIC).length === 1);
    const first = payload(4097, 91);
    await node.services.pubsub.publish(TOPIC, first);
    await waitFor(() =>
      zig.events.some((event) => event.event === "message" && event.sha256 === summary(first).sha256)
    );
    await waitFor(async () => (await zig.command("snapshot")).meshMembers > 0);
    const sent = await zig.command("publish", {seed: 92, size: 4098, topic: TOPIC});
    assert(sent.queued > 0);
    await waitFor(() => received.some((entry) => entry.sha256 === summary(payload(4098, 92)).sha256));
    return {
      log,
      messages: [summary(first), summary(payload(4098, 92))],
      native,
      nativeDials,
      peer: connection.remotePeer.toString(),
    };
  } catch (error) {
    throw Error(`${error.stack}\n${JSON.stringify({events: zig.events, log, stderr: zig.stderr})}`);
  } finally {
    await node?.stop();
    await zig.stop();
  }
}
const outcomes = [];
for (const nativeDials of [false, true]) outcomes.push(await exercise(nativeDials));
console.log(
  JSON.stringify(
    {hostRoot: hostRoot === "installed" ? hostRoot : resolve(hostRoot), ok: true, outcomes, versions},
    null,
    2
  )
);
