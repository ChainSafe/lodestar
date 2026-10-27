import {generateKeyPair} from "@libp2p/crypto/keys";
import {type GossipSubComponents, StrictNoSign, gossipsub} from "@libp2p/gossipsub";
import {type Connection, type Startable, type Stream, TimeoutError, type Topology} from "@libp2p/interface";
import {defaultLogger} from "@libp2p/logger";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {afterEach, describe, expect, it, vi} from "vitest";
import {getValidPeerId} from "../../../utils/peer.js";

describe("gossipsub outbound stream recovery", () => {
  const cleanups: (() => Promise<void> | void)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
    vi.useRealTimers();
  });

  async function setup() {
    const privateKey = await generateKeyPair("secp256k1");
    vi.useFakeTimers();
    const peer = getValidPeerId();
    const streamEvents = new EventTarget();
    const send = vi.fn(() => true);
    const close = vi.fn(async () => {});
    const stream = Object.assign(streamEvents, {
      protocol: "/meshsub/1.2.0",
      status: "open",
      send,
      close,
    }) as unknown as Stream;
    const newStream = vi.fn<Connection["newStream"]>().mockResolvedValue(stream);
    const connection = {
      remotePeer: peer,
      remoteAddr: multiaddr("/ip4/127.0.0.1/tcp/9000"),
      direction: "outbound",
      status: "open",
      newStream,
    } as unknown as Connection;
    const getConnections = vi.fn(() => [connection]);
    const register = vi.fn(async (_protocol: string, _topology: Topology) => "topology");
    const router = gossipsub({globalSignaturePolicy: StrictNoSign, tagMeshPeers: false})({
      privateKey,
      peerId: peerIdFromPrivateKey(privateKey),
      logger: defaultLogger(),
      registrar: {register, handle: vi.fn(), unhandle: vi.fn(), unregister: vi.fn()},
      peerStore: {},
      connectionManager: {getConnections},
    } as unknown as GossipSubComponents);
    const lifecycle = router as typeof router & Startable;
    await lifecycle.start();
    cleanups.push(() => lifecycle.stop());
    router.subscribe("test-topic");
    const topology = register.mock.calls[0][1];

    return {
      router,
      lifecycle,
      topology,
      peer,
      connection,
      newStream,
      stream,
      streamEvents,
      send,
      close,
      getConnections,
    };
  }

  it("retries a failed open and announces existing subscriptions", async () => {
    const {topology, peer, connection, newStream, send} = await setup();
    newStream.mockRejectedValueOnce(new TimeoutError());
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(newStream).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(newStream).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(newStream).toHaveBeenCalledTimes(2);
  });

  it("backs off repeated failures and deduplicates connection notifications", async () => {
    const {topology, peer, connection, newStream} = await setup();
    newStream.mockRejectedValue(new TimeoutError());
    topology.onConnect?.(peer, connection);
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(0);
    expect(newStream).toHaveBeenCalledTimes(1);
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(500);
    expect(newStream).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(newStream.mock.calls.length).toBeGreaterThan(2);
    expect(newStream.mock.calls.length).toBeLessThan(10);
  });

  it("reopens an unexpectedly closed outbound stream", async () => {
    const {topology, peer, connection, newStream, streamEvents} = await setup();
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(0);
    streamEvents.dispatchEvent(new Event("close"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(newStream).toHaveBeenCalledTimes(2);
  });

  it("uses the current connection when retrying", async () => {
    const {topology, peer, connection, newStream, stream, getConnections} = await setup();
    newStream.mockRejectedValue(new TimeoutError());
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(0);
    const replacementNewStream = vi.fn<Connection["newStream"]>().mockResolvedValue(stream);
    getConnections.mockReturnValue([{...connection, newStream: replacementNewStream}]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(newStream).toHaveBeenCalledTimes(1);
    expect(replacementNewStream).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnect", "stop"])("cancels retries on %s", async (action) => {
    const {lifecycle, topology, peer, connection, newStream} = await setup();
    newStream.mockRejectedValue(new TimeoutError());
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(0);
    if (action === "disconnect") topology.onDisconnect?.(peer);
    else await lifecycle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(newStream).toHaveBeenCalledTimes(1);
  });

  it("closes a stream that finishes opening after shutdown", async () => {
    const {lifecycle, topology, peer, connection, newStream, stream, close, send} = await setup();
    let resolveStream!: (stream: Stream) => void;
    newStream.mockReturnValue(
      new Promise<Stream>((resolve) => {
        resolveStream = resolve;
      })
    );
    topology.onConnect?.(peer, connection);
    await vi.advanceTimersByTimeAsync(0);
    await lifecycle.stop();
    resolveStream(stream);
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
