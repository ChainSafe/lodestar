import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {expect, it, vi} from "vitest";
import type {NativeGossipDiagnosticsPage, NativeNetwork, NativePeerState} from "@chainsafe/lodestar-z/network";
import {
  dumpNativeGossipScores,
  dumpNativeMeshPeers,
  dumpNativePeerScores,
} from "../../../../src/network/core/native/diagnostics.js";
import {NativeNetworkErrorCode} from "../../../../src/network/core/native/errors.js";

async function fixture() {
  const key = await generateKeyPair("secp256k1");
  const identity = peerIdFromPublicKey(key.publicKey).toString();
  const page: NativeGossipDiagnosticsPage = {
    ownerSequence: 1n,
    observedMonoMs: 10000n,
    observedUnixMs: 1000000n,
    nextCursor: null,
    topics: [
      {index: 3, topic: "block", subscribed: true, weight: 0.5, meshDeliveryActivationMs: 1000n},
      {index: 4, topic: "empty", subscribed: true, weight: 1, meshDeliveryActivationMs: 0n},
    ],
    peers: [
      {
        identity,
        ip: Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1]),
        connected: true,
        outboundReady: true,
        expireAtMs: 0n,
        score: -5,
        appScore: 0,
        behaviourPenalty: 1,
        weights: {p5: 0, p6: 0, p7: -1},
        topics: [
          {
            index: 3,
            inMesh: true,
            meshMember: true,
            graftTimeMs: 8000n,
            meshTimeMs: 2000n,
            firstMessageDeliveries: 1,
            meshMessageDeliveries: 2,
            meshFailurePenalty: 0,
            invalidMessageDeliveries: 1,
            weights: {p1: 1, p2: 1, p3: 0, p3b: 0, p4: -6},
          },
        ],
      },
    ],
  };
  const peer: NativePeerState = {
    identity,
    connection: {index: 0, generation: 1},
    direction: "inbound",
    endpoint: {family: 4, address: Uint8Array.of(127, 0, 0, 1), port: 9000},
    relevant: true,
    disconnectReason: null,
    status: null,
    metadata: null,
    identify: null,
    statusAtMs: 0n,
    metadataAtMs: 0n,
    custodyGroups: null,
    samplingGroups: null,
    connectedAtMs: 0n,
    direct: false,
    score: -2,
    scoreAtMs: 9000n,
    banUntilMs: 0n,
    goodbyeUntilMs: 0n,
    redialUntilMs: 0n,
  };
  const runtime = {
    getGossipDiagnostics: vi.fn(async () => page),
    getPeers: vi.fn(async () => ({
      peers: [peer],
      occupiedCount: 1,
      capacity: 8,
      counts: {connected: 1, relevant: 1, outboundRelevant: 0},
      ownerSequence: 1n,
    })),
  } satisfies Pick<NativeNetwork, "getPeers" | "getGossipDiagnostics">;
  return {page, peer, runtime, peerId: peerIdFromPublicKey(key.publicKey).toString()};
}

it("exposes native score components, real timestamps, IPs and empty mesh subscriptions", async () => {
  const {runtime, peerId} = await fixture();
  const gossip = await dumpNativeGossipScores(runtime);
  expect(gossip[peerId]).toMatchObject({
    connected: true,
    expire: 0,
    behaviourPenalty: 1,
    score: -5,
    knownIPs: new Set(["127.0.0.1"]),
    weights: {p7: -1},
    topics: {
      block: {
        inMesh: true,
        graftTime: 998000,
        meshTime: 2000,
        meshMessageDeliveriesActive: true,
        firstMessageDeliveries: 1,
        meshMessageDeliveries: 2,
        invalidMessageDeliveries: 1,
        topicWeight: 0.5,
        weights: {p4: -6},
      },
    },
  });
  expect(await dumpNativeMeshPeers(runtime)).toEqual({block: [peerId], empty: []});
  expect(await dumpNativePeerScores(runtime)).toEqual([
    {peerId, lodestarScore: -2, gossipScore: -5, ignoreNegativeGossipScore: false, score: -7, lastUpdate: 999000},
  ]);
});

it("traverses sparse pages and deduplicates peers across owner turns", async () => {
  const {page, runtime, peerId} = await fixture();
  runtime.getGossipDiagnostics.mockResolvedValueOnce({...page, nextCursor: 40}).mockResolvedValueOnce(page);
  expect(await dumpNativeMeshPeers(runtime)).toEqual({block: [peerId], empty: []});
  expect(runtime.getGossipDiagnostics).toHaveBeenNthCalledWith(2, 40);
});

it("refuses non-advancing diagnostic cursors instead of looping", async () => {
  const {page, runtime} = await fixture();
  page.nextCursor = 0;
  await expect(dumpNativeMeshPeers(runtime)).rejects.toMatchObject({
    type: {code: NativeNetworkErrorCode.CONFIGURATION},
  });
  expect(runtime.getGossipDiagnostics).toHaveBeenCalledTimes(1);
});

it("includes RPC peers without gossip scores and distinguishes retained scores from actual mesh membership", async () => {
  const {page, runtime, peerId} = await fixture();
  page.peers[0].connected = false;
  page.peers[0].expireAtMs = 12000n;
  page.peers[0].topics[0].meshMember = false;
  page.peers[0].topics[0].inMesh = false;
  expect(await dumpNativeMeshPeers(runtime)).toEqual({block: [], empty: []});
  expect((await dumpNativeGossipScores(runtime))[peerId]).toMatchObject({connected: false, expire: 1002000});
  page.peers = [];
  expect(await dumpNativePeerScores(runtime)).toMatchObject([{peerId, gossipScore: 0, score: -2}]);
});
