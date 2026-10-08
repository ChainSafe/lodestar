import {describe, expect, it, vi} from "vitest";
import {CloseResult} from "@chainsafe/lodestar-z/network";
import {defer} from "@lodestar/utils";
import {NativeNetworkCore} from "../../../../src/network/core/native/nativeNetworkCore.js";
import {ClockEvent} from "../../../../src/util/clock.js";

function fixture() {
  const core = Object.create(NativeNetworkCore.prototype) as NativeNetworkCore;
  const clock = {off: vi.fn()};
  const onSlot = vi.fn();
  const gossip = {close: vi.fn()};
  const requests = {close: vi.fn()};
  const peers = {close: vi.fn()};
  const intent = {close: vi.fn()};
  const remembered = {close: vi.fn(async () => {})};
  const nativeClosed = defer<CloseResult>();
  const network = {
    closed: nativeClosed.promise,
    setDirectPeer: vi.fn(async () => {}),
    connect: vi.fn(async () => {}),
    stopDelivery: vi.fn(),
    close: vi.fn((): Promise<CloseResult> => {
      nativeClosed.resolve({reason: "requested"});
      return nativeClosed.promise;
    }),
  };
  Object.assign(core, {modules: {clock}, onSlot, gossip, requests, peers, intent, remembered, network});
  return {core, clock, onSlot, gossip, requests, peers, intent, remembered, network, nativeClosed};
}

describe("native core close", () => {
  it.each(["NetworkClosed", "Stopped"])("ignores %s from direct-peer registration during close", async (code) => {
    const {core, network} = fixture();
    const registration = defer<void>();
    network.setDirectPeer.mockReturnValue(registration.promise);
    const starting = core["connectConfiguredPeers"](
      [{peerId: "direct", addresses: []}],
      [{peerId: "boot", addresses: []}]
    );
    expect(network.setDirectPeer).toHaveBeenCalledOnce();
    const closing = core.close();
    registration.reject(Object.assign(new Error(code), {code}));
    await expect(starting).resolves.toBeUndefined();
    await closing;
    await expect(core.terminated).resolves.toBeNull();
    expect(network.connect).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves direct-peer registration failures, closing: %s", async (closing) => {
    const {core, network} = fixture();
    const registration = defer<void>();
    network.setDirectPeer.mockReturnValue(registration.promise);
    const starting = core["connectConfiguredPeers"]([{peerId: "direct", addresses: []}], []);
    const failure = Object.assign(new Error("owner failed"), {code: "OwnerFailed"});
    if (closing) await core.close();
    registration.reject(failure);
    await expect(starting).rejects.toBe(failure);
    await core.close();
  });

  it("preserves an unexpected NetworkClosed while running", async () => {
    const {core, network} = fixture();
    const failure = Object.assign(new Error("NetworkClosed"), {code: "NetworkClosed"});
    network.setDirectPeer.mockRejectedValue(failure);
    await expect(core["connectConfiguredPeers"]([{peerId: "direct", addresses: []}], [])).rejects.toBe(failure);
    await core.close();
  });

  it("stops delivery before cleanup and the final snapshot, then closes native with one shared completion", async () => {
    const {core, remembered, network, clock, onSlot, gossip, requests, peers, intent} = fixture();
    const snapshot = defer<void>();
    const joined = defer<CloseResult>();
    remembered.close.mockReturnValue(snapshot.promise);
    network.close.mockReturnValue(joined.promise);
    const first = core.close();
    expect(core.close()).toBe(first);
    expect(network.stopDelivery).toHaveBeenCalledOnce();
    for (const cleanup of [clock.off, gossip.close, requests.close, peers.close, intent.close, remembered.close]) {
      expect(cleanup).toHaveBeenCalledOnce();
      expect(network.stopDelivery).toHaveBeenCalledBefore(cleanup);
    }
    expect(clock.off).toHaveBeenCalledExactlyOnceWith(ClockEvent.slot, onSlot);
    expect(network.close).not.toHaveBeenCalled();
    snapshot.resolve();
    await Promise.resolve();
    expect(network.close).toHaveBeenCalledOnce();
    let settled = false;
    void first.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    joined.resolve({reason: "requested"});
    await first;
    expect(core.close()).toBe(first);
  });

  it("joins native after a rejected snapshot, then rejects every closer", async () => {
    const {core, remembered, network} = fixture();
    const error = new Error("snapshot failed");
    remembered.close.mockRejectedValue(error);
    const first = core.close();
    await expect(first).rejects.toBe(error);
    expect(network.close).toHaveBeenCalledOnce();
    expect(core.close()).toBe(first);
  });

  it("continues all cleanup and native close after a synchronous cleanup failure", async () => {
    const {core, gossip, requests, peers, intent, remembered, network} = fixture();
    const error = new Error("gossip cleanup failed");
    gossip.close.mockImplementation(() => {
      throw error;
    });
    let first: Promise<void> | undefined;
    expect(() => {
      first = core.close();
    }).not.toThrow();
    await expect(first).rejects.toBe(error);
    for (const close of [requests.close, peers.close, intent.close, remembered.close, network.close]) {
      expect(close).toHaveBeenCalledOnce();
    }
    expect(core.close()).toBe(first);
  });

  it("preserves both snapshot and native join failures", async () => {
    const {core, remembered, network} = fixture();
    const snapshotError = new Error("snapshot failed");
    const joinError = new Error("join failed");
    remembered.close.mockRejectedValue(snapshotError);
    network.close.mockRejectedValue(joinError);
    await expect(core.close()).rejects.toMatchObject({errors: [snapshotError, joinError]});
    expect(network.close).toHaveBeenCalledOnce();
  });

  it("reports a failure during close through terminated while cleanup succeeds", async () => {
    const {core, network, nativeClosed} = fixture();
    const error = new Error("owner failed during close");
    network.close.mockReturnValue(nativeClosed.promise);
    const terminated = core.terminated;
    const closing = core.close();
    await Promise.resolve();
    expect(network.close).toHaveBeenCalledOnce();
    nativeClosed.resolve({reason: "failed", error});
    await expect(closing).resolves.toBeUndefined();
    await expect(terminated).resolves.toBe(error);
  });

  it("reports the host failure separately from a cleanup failure", async () => {
    const {core, remembered, nativeClosed} = fixture();
    const failure = new Error("host failed");
    const cleanupError = new Error("snapshot failed");
    Object.assign(core, {failure});
    remembered.close.mockRejectedValue(cleanupError);
    nativeClosed.resolve({reason: "requested"});
    await expect(core.close()).rejects.toBe(cleanupError);
    await expect(core.terminated).resolves.toBe(failure);
  });

  it("latches completion before a reentrant cleanup", async () => {
    const {core, gossip} = fixture();
    let reentrant: Promise<void> | undefined;
    gossip.close.mockImplementation(() => {
      reentrant = core.close();
    });
    const first = core.close();
    expect(reentrant).toBe(first);
    await first;
  });
});
