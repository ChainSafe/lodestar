import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {describe, expect, it, vi} from "vitest";
import {NativePeerObservation, NativePeerState} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {NativePeers, formatNativePeer} from "../../../../src/network/core/native/peers.js";
import {NetworkEvent, NetworkEventBus} from "../../../../src/network/events.js";

async function fixture() {
  const key = await generateKeyPair("secp256k1");
  const state: NativePeerState = {
    identity: peerIdFromPublicKey(key.publicKey).toString(),
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
    redialUntilMs: 0n,
  };
  const disconnect = vi.fn(async () => {});
  const runtime = {disconnect};
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
    events,
    peers,
    drain(...events: NativePeerObservation[]) {
      peers.deliver(events);
    },
  };
}

describe("native peer projection", () => {
  it("propagates a listener failure after recording the peer and stops the remaining observations", async () => {
    const node = await fixture();
    const failure = new Error("peer consumer failed");
    const laterListener = vi.fn();
    node.events.on(NetworkEvent.peerConnected, laterListener);
    node.connected.mockImplementationOnce(() => {
      throw failure;
    });
    const other = {...node.state, identity: "another-peer", connection: {index: 1, generation: 1}};
    try {
      expect(() => node.drain({type: "ready", state: node.state}, {type: "ready", state: other})).toThrow(failure);
      expect(node.peers.connected()).toEqual([node.state.identity]);
      expect(laterListener).not.toHaveBeenCalled();

      node.drain({type: "updated", state: structuredClone(node.state)});
      expect(node.connected).toHaveBeenCalledOnce();
      expect(laterListener).not.toHaveBeenCalled();
    } finally {
      node.peers.close();
    }
  });

  it("propagates a disconnect listener failure after removing the peer", async () => {
    const node = await fixture();
    const failure = new Error("peer removal failed");
    const laterListener = vi.fn();
    node.events.on(NetworkEvent.peerDisconnected, laterListener);
    node.disconnected.mockImplementationOnce(() => {
      throw failure;
    });
    const closed: NativePeerObservation = {
      type: "closed",
      identity: node.state.identity,
      connection: {index: 0, generation: 17},
      reason: "host",
    };
    try {
      node.drain({type: "ready", state: node.state});
      expect(() => node.drain(closed)).toThrow(failure);
      expect(node.peers.connected()).toEqual([]);
      expect(laterListener).not.toHaveBeenCalled();

      node.drain(closed);
      expect(node.disconnected).toHaveBeenCalledOnce();
      expect(laterListener).not.toHaveBeenCalled();
    } finally {
      node.peers.close();
    }
  });

  it("skips unrelated updates while preserving status, custody and client updates", async () => {
    const node = await fixture();
    let state = node.state;
    const update = (changes: Partial<NativePeerState>) => {
      state = {...structuredClone(state), ...changes};
      node.drain({type: "updated", state});
    };
    node.drain({type: "ready", state});
    update({endpoint: {...state.endpoint, port: 9002}});
    update({score: 10, metadataAtMs: 20n, samplingGroups: [1]});
    expect(node.connected).toHaveBeenCalledOnce();
    expect(node.disconnected).not.toHaveBeenCalled();
    update({statusAtMs: 30n});
    expect(node.connected).toHaveBeenCalledTimes(2);
    if (!state.status) throw Error("Missing test status");
    update({status: {...state.status, headSlot: 10n}});
    expect(node.connected).toHaveBeenCalledTimes(3);
    update({custodyGroups: [0]});
    expect(node.connected).toHaveBeenCalledTimes(4);
    expect(node.connected.mock.lastCall?.[0].custodyColumns.length).toBeGreaterThan(0);
    update({identify: {agent: "Lighthouse/v8.2.2", protocolVersion: null, protocols: []}});
    expect(node.connected).toHaveBeenCalledTimes(5);
    update({identify: {agent: "Lighthouse/v8.2.3", protocolVersion: "eth2/1.0.0", protocols: []}});
    expect(node.connected).toHaveBeenCalledTimes(5);
    update({relevant: false});
    expect(node.disconnected).toHaveBeenCalledOnce();
    update({relevant: true});
    expect(node.connected).toHaveBeenCalledTimes(6);
    node.peers.close();
    expect(node.peers.connectedCount).toBe(0);
  });

  it.each([
    ["Lighthouse/v8.2.2", "Lighthouse"],
    ["peer-controlled-unique-agent", "Unknown"],
    ["", "Unknown"],
  ])("bounds the client label for %s while preserving diagnostic agent text", async (agent, clientAgent) => {
    const node = await fixture();
    node.state.identify = {agent, protocolVersion: null, protocols: []};
    node.drain({type: "ready", state: node.state});
    expect(node.connected).toHaveBeenCalledWith(expect.objectContaining({clientAgent}));
    expect(formatNativePeer(node.state).agentVersion).toBe(agent);
    node.peers.close();
  });

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
  it("keeps a newer same-peer connection when an old close arrives after its replacement", async () => {
    const node = await fixture();
    const old = node.state;
    const current = {...old, connection: {index: 0, generation: 18}};
    node.drain({type: "ready", state: old}, {type: "updated", state: current});
    if (!old.connection) throw new Error("Missing test connection");
    node.drain({
      type: "closed",

      identity: old.identity,
      connection: old.connection,
      reason: "host",
    });
    expect(node.disconnected).not.toHaveBeenCalled();
    expect(node.peers.connected()).toEqual([current.identity]);
    expect(node.peers.connectedCount).toBe(1);
    node.drain({
      type: "closed",

      identity: current.identity,
      connection: current.connection,
      reason: "host",
    });
    expect(node.disconnected).toHaveBeenCalledOnce();
    expect(node.peers.connected()).toEqual([]);
    expect(node.peers.connectedCount).toBe(0);
    node.peers.close();
  });

  it.each(["finalizedEpoch", "earliestAvailableSlot"] as const)(
    "isolates a peer with an unrepresentable Status %s",
    async (field) => {
      const node = await fixture();
      if (!node.state.status) throw new Error("Missing test status");
      const bad = {...node.state, status: {...node.state.status, [field]: (1n << 64n) - 1n}};
      expect(() => node.drain({type: "ready", state: bad})).not.toThrow();
      expect(node.connected).not.toHaveBeenCalled();
      expect(node.disconnect).toHaveBeenCalledWith(bad.identity);
      node.drain({type: "updated", state: bad});
      expect(node.disconnect).toHaveBeenCalledOnce();
      node.drain({type: "ready", state: {...node.state, connection: {index: 0, generation: 18}}});
      expect(node.connected).toHaveBeenCalledOnce();
      node.peers.close();
    }
  );
});
