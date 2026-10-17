import {setImmediate} from "node:timers/promises";
import {describe, expect, it, vi} from "vitest";
import {NativeNetwork} from "@chainsafe/lodestar-z/network";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {NativeIntent} from "../../../../src/network/core/native/intent.js";

function fixture() {
  const applyIntent = vi.fn<NativeNetwork["applyIntent"]>(async () => {});
  const updateStatus = vi.fn<NativeNetwork["updateStatus"]>(async () => undefined);
  return {applyIntent, updateStatus, intent: new NativeIntent({applyIntent, updateStatus})};
}

describe("native local intent ordering", () => {
  it("submits nothing until the host changes state", async () => {
    const node = fixture();
    await setImmediate();
    expect(node.applyIntent).not.toHaveBeenCalled();
    expect(node.updateStatus).not.toHaveBeenCalled();
    node.intent.close();
  });
  it("serializes Status updates and snapshots caller roots", async () => {
    const node = fixture();
    const held = defer<void>();
    node.updateStatus.mockReturnValueOnce(held.promise);
    const active = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 1});
    await Promise.resolve();
    const pending = Array.from({length: 3}, (_, index) =>
      node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: index + 2})
    );
    expect(node.updateStatus).toHaveBeenCalledTimes(1);
    held.resolve();
    await Promise.all([active, ...pending]);
    expect(node.updateStatus.mock.calls.map(([status]) => status.headSlot)).toEqual([1n, 2n, 3n, 4n]);
    const status = ssz.fulu.Status.defaultValue();
    status.headRoot.fill(7);
    const changed = node.intent.updateStatus(status);
    status.headRoot.fill(9);
    await changed;
    expect(node.updateStatus.mock.calls.at(-1)?.[0].headRoot).toEqual(new Uint8Array(32).fill(7));
    node.intent.close();
  });
  it("submits sparse flags, status and duties without replacing native-owned state", async () => {
    const node = fixture();
    const first = node.intent.coreTopics(true);
    const status = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 12});
    const custody = node.intent.custody(16);
    const duty = {slot: 2, subnet: 1, validatorIndex: 0, isAggregator: true};
    const att = node.intent.committee([duty], false);
    const sync = node.intent.committee([duty], true);
    await Promise.all([first, status, custody, att, sync]);
    expect(node.updateStatus).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({headSlot: 12n}));
    expect(node.applyIntent.mock.calls.map(([patch]) => patch)).toEqual([
      {coreTopics: true},
      {custodyGroupCount: 16n},
      {attesters: [{slot: 2, subnets: 2n, aggregators: 2n}], syncCommittees: []},
      {attesters: [], syncCommittees: [{subnet: 1, untilSlot: 2}]},
    ]);
    expect(node.intent.isSubscribedToCoreTopics()).toBe(true);
    await node.intent.custody(8);
    expect(node.applyIntent.mock.calls.at(-1)?.[0]).toEqual({custodyGroupCount: 8n});
    node.intent.close();
  });
  it("acknowledges core subscriptions in submission order only after native commits and preserves state on rejection", async () => {
    const node = fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    node.applyIntent.mockReturnValueOnce(held.promise);
    const enabled = node.intent.coreTopics(true);
    const disabled = node.intent.coreTopics(false);
    expect(enabled).not.toBe(disabled);
    await Promise.resolve();
    expect(node.intent.isSubscribedToCoreTopics()).toBe(false);
    held.resolve();
    await enabled;
    await disabled;
    expect(node.applyIntent.mock.calls.slice(0, 2)).toEqual([[{coreTopics: true}], [{coreTopics: false}]]);
    expect(node.intent.isSubscribedToCoreTopics()).toBe(false);
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
  it("does not submit queued work after close and leaves admitted work to native", async () => {
    const node = fixture();
    const held = defer<void>();
    node.updateStatus.mockReturnValueOnce(held.promise);
    const active = node.intent.updateStatus(ssz.fulu.Status.defaultValue());
    await Promise.resolve();
    const pending = node.intent.coreTopics(true);
    const rejected = expect(pending).rejects.toThrow("CLOSED");
    node.intent.close();
    held.reject(new Error("NetworkClosed"));
    await expect(active).rejects.toThrow("NetworkClosed");
    await rejected;
    await setImmediate();
    expect(node.applyIntent).not.toHaveBeenCalled();
    expect(node.intent.isSubscribedToCoreTopics()).toBe(false);
  });
});
