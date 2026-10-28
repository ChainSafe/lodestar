import {expect, it, vi} from "vitest";
import type {NativeGossipDiagnosticsPage, NativeNetwork} from "@chainsafe/lodestar-z/network";
import {
  dumpNativeGossipScores,
  dumpNativeMeshPeers,
  dumpNativePeerScores,
} from "../../../../src/network/core/native/diagnostics.js";
import {NativeNetworkErrorCode} from "../../../../src/network/core/native/errors.js";

function fixture() {
  const identity = "peer";
  const page: NativeGossipDiagnosticsPage = {
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
  const runtime = {
    getGossipDiagnostics: vi.fn(async () => page),
    getPeerScores: vi.fn(async () => ({
      observedMonoMs: page.observedMonoMs,
      observedUnixMs: page.observedUnixMs,
      peers: [{identity, score: -2, scoreAtMs: 9000n, gossipScore: page.peers[0]?.score ?? 0}],
    })),
  } satisfies Pick<NativeNetwork, "getPeerScores" | "getGossipDiagnostics">;
  return {page, runtime, peerId: identity};
}

it("exposes native score components, real timestamps, IPs and empty mesh subscriptions", async () => {
  const {runtime, peerId} = fixture();
  expect(await dumpNativePeerScores(runtime)).toEqual([
    {peerId, lodestarScore: -2, gossipScore: -5, ignoreNegativeGossipScore: false, score: -7, lastUpdate: 999000},
  ]);
  expect(runtime.getGossipDiagnostics).not.toHaveBeenCalled();
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
});

it("follows sparse native cursors without a page limit and deduplicates peers across pages", async () => {
  const {page, runtime, peerId} = fixture();
  runtime.getGossipDiagnostics.mockImplementation(async (cursor = 0) => ({
    ...page,
    nextCursor: cursor === 690 ? null : cursor + 10,
  }));
  expect(await dumpNativeMeshPeers(runtime)).toEqual({block: [peerId], empty: []});
  expect(runtime.getGossipDiagnostics).toHaveBeenCalledTimes(70);
  expect(runtime.getGossipDiagnostics).toHaveBeenLastCalledWith(690);
});

it.each([10, 20])("rejects a cursor that does not advance: %s after 20", async (cursor) => {
  const {page, runtime} = fixture();
  runtime.getGossipDiagnostics
    .mockResolvedValueOnce({...page, nextCursor: 20})
    .mockResolvedValueOnce({...page, nextCursor: cursor});
  await expect(dumpNativeMeshPeers(runtime)).rejects.toMatchObject({
    type: {code: NativeNetworkErrorCode.CONFIGURATION},
  });
  expect(runtime.getGossipDiagnostics).toHaveBeenCalledTimes(2);
});

it("includes RPC peers without gossip scores and distinguishes retained scores from actual mesh membership", async () => {
  const {page, runtime, peerId} = fixture();
  page.peers[0].connected = false;
  page.peers[0].expireAtMs = 12000n;
  page.peers[0].topics[0].meshMember = false;
  page.peers[0].topics[0].inMesh = false;
  expect(await dumpNativeMeshPeers(runtime)).toEqual({block: [], empty: []});
  expect((await dumpNativeGossipScores(runtime))[peerId]).toMatchObject({connected: false, expire: 1002000});
  page.peers = [];
  expect(await dumpNativePeerScores(runtime)).toMatchObject([{peerId, gossipScore: 0, score: -2}]);
});
