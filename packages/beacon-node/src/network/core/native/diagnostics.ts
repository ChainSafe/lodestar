import type {PeerScoreStatsDump} from "@libp2p/gossipsub/score";
import type {NativeGossipDiagnosticsPage, NativeNetwork} from "@chainsafe/lodestar-z/network";
import type {PeerScoreStats} from "../../peers/score/interface.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

type Network = Pick<NativeNetwork, "getPeerScores" | "getGossipDiagnostics">;

async function visitPages(network: Network, visit: (page: NativeGossipDiagnosticsPage) => void): Promise<void> {
  let cursor = 0;
  for (;;) {
    const page = await network.getGossipDiagnostics(cursor);
    visit(page);
    if (page.nextCursor === null) return;
    cursor = nativeInteger(page.nextCursor, "gossip diagnostics cursor", undefined, cursor + 1);
  }
}

function unixTime(time: bigint, page: Pick<NativeGossipDiagnosticsPage, "observedUnixMs" | "observedMonoMs">): number {
  return time === 0n
    ? 0
    : nativeInteger(Number(page.observedUnixMs + time - page.observedMonoMs), "diagnostic timestamp");
}

function ipString(ip: Uint8Array): string | null {
  if (ip.length !== 16)
    throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "diagnostic IP length"});
  if (ip.every((byte) => byte === 0)) return null;
  if (ip.subarray(0, 10).every((byte) => byte === 0) && ip[10] === 255 && ip[11] === 255)
    return Array.from(ip.subarray(12)).join(".");
  const groups: string[] = [];
  for (let i = 0; i < 16; i += 2) groups.push(((ip[i] << 8) | ip[i + 1]).toString(16));
  return groups.join(":");
}

export async function dumpNativeGossipScores(network: Network): Promise<PeerScoreStatsDump> {
  const dump: PeerScoreStatsDump = {};
  await visitPages(network, (page) => {
    const names = new Map(page.topics.map((topic) => [topic.index, topic]));
    for (const peer of page.peers) {
      const topics: PeerScoreStatsDump[string]["topics"] = {};
      for (const entry of peer.topics) {
        const topic = names.get(entry.index);
        if (!topic)
          throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "diagnostic topic"});
        const stats = {
          inMesh: entry.inMesh,
          graftTime: unixTime(entry.graftTimeMs, page),
          meshTime: nativeInteger(Number(entry.meshTimeMs), "diagnostic mesh duration"),
          firstMessageDeliveries: entry.firstMessageDeliveries,
          meshMessageDeliveries: entry.meshMessageDeliveries,
          meshMessageDeliveriesActive: entry.inMesh && entry.meshTimeMs > topic.meshDeliveryActivationMs,
          meshFailurePenalty: entry.meshFailurePenalty,
          invalidMessageDeliveries: entry.invalidMessageDeliveries,
          topicWeight: topic.weight,
          weights: entry.weights,
        };
        topics[topic.topic] = stats;
      }
      const ip = ipString(peer.ip);
      const stats = {
        connected: peer.connected,
        expire: unixTime(peer.expireAtMs, page),
        topics,
        knownIPs: new Set(ip === null ? [] : [ip]),
        behaviourPenalty: peer.behaviourPenalty,
        score: peer.score,
        appScore: peer.appScore,
        weights: peer.weights,
        outboundReady: peer.outboundReady,
      };
      dump[peer.identity] = stats;
    }
  });
  return dump;
}

export async function dumpNativeMeshPeers(network: Network): Promise<Record<string, string[]>> {
  const meshes = new Map<string, Set<string>>();
  await visitPages(network, (page) => {
    const names = new Map(page.topics.map((topic) => [topic.index, topic]));
    for (const topic of page.topics) {
      if (topic.subscribed && !meshes.has(topic.topic)) meshes.set(topic.topic, new Set());
    }
    for (const peer of page.peers) {
      const identity = peer.identity;
      for (const entry of peer.topics) {
        const topic = names.get(entry.index);
        if (entry.meshMember && topic?.subscribed) meshes.get(topic.topic)?.add(identity);
      }
    }
  });
  return Object.fromEntries(Array.from(meshes, ([topic, peers]) => [topic, Array.from(peers)]));
}

export async function dumpNativePeerScores(network: Network): Promise<PeerScoreStats> {
  const snapshot = await network.getPeerScores();
  return snapshot.peers.map((peer) => {
    const peerId = peer.identity;
    const gossipScore = peer.gossipScore;
    return {
      peerId,
      lodestarScore: peer.score,
      gossipScore,
      ignoreNegativeGossipScore: false,
      score: peer.score + gossipScore,
      lastUpdate: unixTime(peer.scoreAtMs, snapshot),
    };
  });
}
