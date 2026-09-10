import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it, vi} from "vitest";
import {NativePeerObservation, NativePeerState} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {NativePeers, formatNativePeer} from "../../../../src/network/core/native/peers.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";

async function fixture() {
  const key = await generateKeyPair("secp256k1");
  const state: NativePeerState = {
    session: (1n << 62n) + 1n,
    peer: {index: 0, generation: (1n << 63n) + 1n},
    identity: key.publicKey.toMultihash().bytes,
    connection: {index: 0, generation: 17},
    direction: "inbound",
    endpoint: {family: 4, address: Uint8Array.of(127, 0, 0, 1), port: 9001},
    relevant: true,
    disconnectReason: null,
    status: {
      forkDigest: new Uint8Array(4),
      finalizedRoot: new Uint8Array(32),
      finalizedEpoch: 0n,
      headRoot: new Uint8Array(32),
      headSlot: 0n,
      earliestAvailableSlot: 0n,
    },
    metadata: null,
    identify: null,
    statusAtMs: 0n,
    metadataAtMs: 0n,
    custodyGroups: null,
    samplingGroups: null,
    connectedAtMs: 0n,
    direct: false,
    score: 0,
    scoreAtMs: 0n,
    banUntilMs: 0n,
    goodbyeUntilMs: 0n,
  };
  const queue: NativePeerObservation[] = [];
  const disconnect = vi.fn(async () => {});
  const runtime = {
    disconnect,
    drainPeers: () => ({events: queue.splice(0), more: false, ownerSequence: 100n, updatesReplaceState: true as const}),
  };
  const events = new NetworkEventBus();
  const connected = vi.fn();
  const disconnected = vi.fn();
  events.on(NetworkEvent.peerConnected, connected);
  events.on(NetworkEvent.peerDisconnected, disconnected);
  const peers = new NativePeers(runtime, createBeaconConfig({}, new Uint8Array(32)), events, 64);
  return {
    state,
    connected,
    disconnected,
    disconnect,
    peers,
    drain(...events: NativePeerObservation[]) {
      queue.push(...events);
      peers.drain(32);
    },
  };
}

describe("native peer projection", () => {
  it("formats peer diagnostics without narrowing remote uint64 values or inventing timestamps", async () => {
    const {state} = await fixture();
    if (!state.status) throw new Error("Missing test status");
    state.status.headSlot = (1n << 64n) - 1n;
    state.identify = {agent: "Lighthouse/v8.2.2", protocolVersion: null, protocols: []};
    state.metadata = {
      sequenceNumber: (1n << 64n) - 1n,
      attnets: Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0),
      syncnets: 2,
      custodyGroupCount: 4n,
    };
    const peer = formatNativePeer(state);
    expect(peer).toMatchObject({
      state: "connected",
      direction: "inbound",
      agentClient: "Lighthouse",
      agentVersion: "Lighthouse/v8.2.2",
      status: {head_slot: "18446744073709551615", earliest_available_slot: "0"},
      metadata: {
        seq_number: "18446744073709551615",
        attnets: "0x0100000000000000",
        syncnets: "0x02",
        custody_group_count: "4",
      },
      lastReceivedMsgUnixTsMs: 0,
      lastStatusUnixTsMs: 0,
      connectedUnixTsMs: 0,
    });
    expect(peer.lastSeenP2pAddress).toBe(`/ip4/127.0.0.1/udp/9001/quic-v1/p2p/${peer.peerId}`);
    expect(JSON.stringify(peer)).toContain("18446744073709551615");
    expect(formatNativePeer({...state, connection: null, status: null, metadata: null, identify: null})).toMatchObject({
      state: "disconnected",
      direction: null,
      status: null,
      metadata: null,
      agentClient: "Unknown",
    });
  });
  it("keeps a newer same-peer connection when an old close arrives with a higher owner sequence", async () => {
    const node = await fixture();
    const old = node.state;
    const current = {...old, connection: {index: 0, generation: 18}};
    node.drain({type: "ready", state: old, ownerSequence: 1n}, {type: "updated", state: current, ownerSequence: 2n});
    if (!old.connection) throw new Error("Missing test connection");
    node.drain({
      type: "closed",
      session: old.session,
      peer: old.peer,
      identity: old.identity,
      connection: old.connection,
      ownerSequence: 3n,
      reason: "host",
    });
    expect(node.disconnected).not.toHaveBeenCalled();
    node.drain({
      type: "closed",
      session: current.session,
      peer: current.peer,
      identity: current.identity,
      connection: current.connection,
      ownerSequence: 4n,
      reason: "host",
    });
    expect(node.disconnected).toHaveBeenCalledOnce();
    node.peers.close();
  });

  it.each(["finalizedEpoch", "earliestAvailableSlot"] as const)(
    "isolates a peer with an unrepresentable Status %s",
    async (field) => {
      const node = await fixture();
      if (!node.state.status) throw new Error("Missing test status");
      const bad = {...node.state, status: {...node.state.status, [field]: (1n << 64n) - 1n}};
      expect(() => node.drain({type: "ready", state: bad, ownerSequence: 1n})).not.toThrow();
      expect(node.connected).not.toHaveBeenCalled();
      expect(node.disconnect).toHaveBeenCalledWith(bad.identity);
      node.drain({type: "updated", state: bad, ownerSequence: 2n});
      expect(node.disconnect).toHaveBeenCalledOnce();
      node.drain({type: "ready", state: {...node.state, connection: {index: 0, generation: 18}}, ownerSequence: 3n});
      expect(node.connected).toHaveBeenCalledOnce();
      node.peers.close();
    }
  );
});
