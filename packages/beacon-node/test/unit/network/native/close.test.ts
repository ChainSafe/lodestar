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
  const network = {notifyCapacity: vi.fn(), close: vi.fn(async (): Promise<CloseResult> => ({reason: "requested"}))};
  Object.assign(core, {modules: {clock}, onSlot, gossip, requests, peers, intent, remembered, network});
  return {core, clock, onSlot, gossip, requests, peers, intent, remembered, network};
}

describe("native core close", () => {
  it("takes the final snapshot before closing native and shares one completion", async () => {
    const {core, remembered, network, clock, onSlot} = fixture();
    const snapshot = defer<void>();
    const joined = defer<CloseResult>();
    remembered.close.mockReturnValue(snapshot.promise);
    network.close.mockReturnValue(joined.promise);
    const first = core.close();
    expect(core.close()).toBe(first);
    expect(clock.off).toHaveBeenCalledExactlyOnceWith(ClockEvent.slot, onSlot);
    expect(network.close).not.toHaveBeenCalled();
    snapshot.resolve();
    await vi.waitFor(() => expect(network.close).toHaveBeenCalledOnce());
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

  it("rejects a requested close if native fails while joining", async () => {
    const {core, network} = fixture();
    const error = new Error("owner failed during close");
    network.close.mockResolvedValue({reason: "failed", error});
    await expect(core.close()).rejects.toBe(error);
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
