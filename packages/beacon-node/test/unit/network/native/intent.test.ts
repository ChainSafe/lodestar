import {setImmediate} from "node:timers/promises";
import {describe, expect, it, vi} from "vitest";
import {NativeNetwork} from "@chainsafe/lodestar-z/network";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {NativeIntent} from "../../../../src/network/core/native/intent.js";

function fixture() {
  const applyIntent = vi.fn<NativeNetwork["applyIntent"]>(async () => ({slot: 0n, ownerSequence: 1n, changed: true}));
  const updateStatus = vi.fn<NativeNetwork["updateStatus"]>(async () => undefined);
  return {applyIntent, updateStatus, intent: new NativeIntent({applyIntent, updateStatus})};
}

describe("native local intent coalescing", () => {
  it("submits nothing until the host changes state", async () => {
    const node = fixture();
    await setImmediate();
    expect(node.applyIntent).not.toHaveBeenCalled();
    expect(node.updateStatus).not.toHaveBeenCalled();
    node.intent.close();
  });
  it("coalesces Status bursts beside an active update and snapshots caller roots", async () => {
    const node = fixture();
    const held = defer<void>();
    node.updateStatus.mockReturnValueOnce(held.promise);
    const active = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 1});
    await Promise.resolve();
    const pending = Array.from({length: 1000}, (_, index) =>
      node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: index + 2})
    );
    expect(new Set(pending).size).toBe(1);
    held.resolve();
    await Promise.all([active, ...pending]);
    expect(node.updateStatus.mock.calls.map(([status]) => status.headSlot)).toEqual([1n, 1001n]);
    const status = ssz.fulu.Status.defaultValue();
    status.headRoot.fill(7);
    const changed = node.intent.updateStatus(status);
    status.headRoot.fill(9);
    await changed;
    expect(node.updateStatus.mock.calls.at(-1)?.[0].headRoot).toEqual(new Uint8Array(32).fill(7));
    node.intent.close();
  });
  it("merges sparse flags, status and duties without replacing native-owned state", async () => {
    const node = fixture();
    const first = node.intent.coreTopics(true);
    const status = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 12});
    const custody = node.intent.custody(16);
    const duty = {slot: 2, subnet: 1, validatorIndex: 0, isAggregator: true};
    const att = node.intent.committee([duty], false);
    const sync = node.intent.committee([duty], true);
    expect(new Set([first, status, custody, att, sync]).size).toBe(1);
    await first;
    expect(node.applyIntent.mock.calls[0][0]).toMatchObject({
      coreTopics: true,
      custodyGroupCount: 16n,
      status: {headSlot: 12n},
      attesters: [{slot: 2, subnets: 2n, aggregators: 2n}],
      syncCommittees: [{subnet: 1, untilSlot: 2}],
    });
    expect(node.intent.isSubscribedToCoreTopics()).toBe(true);
    await node.intent.custody(8);
    expect(node.applyIntent.mock.calls.at(-1)?.[0]).toEqual({custodyGroupCount: 8n});
    node.intent.close();
  });
  it("acknowledges coalesced core subscriptions only after native commits and preserves state on rejection", async () => {
    const node = fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    node.applyIntent.mockReturnValueOnce(held.promise);
    const enabled = node.intent.coreTopics(true);
    const disabled = node.intent.coreTopics(false);
    expect(enabled).toBe(disabled);
    await Promise.resolve();
    expect(node.intent.isSubscribedToCoreTopics()).toBe(false);
    held.resolve({slot: 2n, ownerSequence: 1n, changed: false});
    await enabled;
    expect(node.applyIntent.mock.calls[0][0]).toEqual({coreTopics: false});
    await node.intent.coreTopics(true);
    node.applyIntent.mockRejectedValueOnce(new Error("rejected"));
    await expect(node.intent.coreTopics(false)).rejects.toThrow("rejected");
    expect(node.intent.isSubscribedToCoreTopics()).toBe(true);
    node.intent.close();
  });
  it("delegates the custody group ceiling to native configuration", async () => {
    const node = fixture();
    for (const count of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => node.intent.custody(count)).toThrow();
    }
    const failure = new Error("InvalidCustodyCount");
    node.applyIntent.mockRejectedValueOnce(failure);
    await expect(node.intent.custody(129)).rejects.toBe(failure);
    expect(node.applyIntent).toHaveBeenCalledExactlyOnceWith({custodyGroupCount: 129n});
    node.intent.close();
  });
  it("orders Status and subscription updates without carrying failed Status into later patches", async () => {
    const node = fixture();
    const held = defer<void>();
    node.updateStatus.mockReturnValueOnce(held.promise);
    const updating = node.intent.updateStatus(ssz.fulu.Status.defaultValue());
    await Promise.resolve();
    const subscribing = node.intent.coreTopics(true);
    expect(node.applyIntent).not.toHaveBeenCalled();
    held.reject(new Error("status rejected"));
    await expect(updating).rejects.toThrow("status rejected");
    await subscribing;
    expect(node.applyIntent.mock.calls[0][0]).toEqual({coreTopics: true});
    node.intent.close();
  });
  it("rejects active and pending work on close without waiting for native completion", async () => {
    const node = fixture();
    const held = defer<void>();
    node.updateStatus.mockReturnValueOnce(held.promise);
    const active = expect(node.intent.updateStatus(ssz.fulu.Status.defaultValue())).rejects.toThrow("CLOSED");
    await Promise.resolve();
    const pending = node.intent.coreTopics(true);
    const rejected = expect(pending).rejects.toThrow("CLOSED");
    node.intent.close();
    await Promise.all([active, rejected]);
    held.resolve();
    await setImmediate();
    expect(node.applyIntent).not.toHaveBeenCalled();
    expect(node.intent.isSubscribedToCoreTopics()).toBe(false);
  });
});
