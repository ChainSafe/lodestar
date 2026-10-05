import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it, vi} from "vitest";
import {NativeLocalIntent, NativeNetwork} from "@chainsafe/lodestar-z/network";
import {ChainConfig, createBeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {createNativeConfig} from "../../../../src/network/core/native/config.js";
import {NativeIntent} from "../../../../src/network/core/native/intent.js";
import {NetworkOptions, defaultNetworkOptions} from "../../../../src/network/options.js";
import {ClockStopped} from "../../../mocks/clock.js";

async function fixture(
  subscribeAllSubnets = false,
  fuluEpoch = 0,
  refreshInitialState = true,
  networkOptions: Partial<NetworkOptions> = {},
  chainConfig: Partial<ChainConfig> = {}
) {
  const config = createBeaconConfig(
    {
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: fuluEpoch,
      GLOAS_FORK_EPOCH: Infinity,
      BLOB_SCHEDULE: [],
      ...chainConfig,
    },
    new Uint8Array(32)
  );
  const opts = {
    ...defaultNetworkOptions,
    tcp: false,
    localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"],
    subscribeAllSubnets,
    ...networkOptions,
  };
  const status = ssz.fulu.Status.defaultValue();
  const clock = new ClockStopped(0);
  const {application, network} = createNativeConfig(
    opts,
    config,
    await generateKeyPair("secp256k1"),
    0,
    status,
    config.CUSTODY_REQUIREMENT,
    16
  );
  application.identitySecretKey.fill(0);
  const applyIntent = vi.fn<NativeNetwork["applyIntent"]>(async (_intent, slot) => ({
    slot,
    ownerSequence: 1n,
    changed: true,
  }));
  const updateStatus = vi.fn<NativeNetwork["updateStatus"]>(async () => undefined);
  const failed = vi.fn();
  const intent = new NativeIntent({applyIntent, updateStatus}, application, network, clock, opts, status, failed);
  if (refreshInitialState) {
    intent.refresh();
    await Promise.resolve();
  }
  return {
    config,
    network,
    clock,
    applyIntent,
    updateStatus,
    intent,
    failed,
    latest: () => {
      const last = applyIntent.mock.calls.at(-1);
      if (!last) throw new Error("Missing native intent");
      return last[0];
    },
  };
}

describe("native local intent transactions", () => {
  it.each(["throw", "reject"])("retries an internal refresh after a no-effect capacity %s", async (mode) => {
    const node = await fixture(false, 0, false);
    const full = Object.assign(new Error("NetworkCommandFull"), {code: "NetworkCommandFull"});
    vi.useFakeTimers();
    try {
      node.applyIntent.mockImplementationOnce(() => {
        if (mode === "throw") throw full;
        return Promise.reject(full);
      });
      node.intent.refresh();
      await Promise.resolve();
      await Promise.resolve();
      expect(node.failed).not.toHaveBeenCalled();
      expect(node.applyIntent).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(1);
      node.clock.setSlot(2);
      node.intent.refresh();
      node.intent.refresh();
      await vi.advanceTimersByTimeAsync(24);
      expect(node.applyIntent).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(node.applyIntent).toHaveBeenCalledTimes(2);
      expect(node.applyIntent.mock.calls.at(-1)?.[1]).toBe(2n);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      node.intent.close();
      vi.useRealTimers();
    }
  });

  it("retains and coalesces custody targets across temporary refusal and slot changes", async () => {
    const node = await fixture(false, 0, false);
    const full = Object.assign(new Error("NetworkCommandFull"), {code: "NetworkCommandFull"});
    vi.useFakeTimers();
    try {
      node.applyIntent.mockRejectedValueOnce(full);
      const first = node.intent.custody(8);
      const completed = vi.fn();
      void first.then(completed);
      await vi.advanceTimersByTimeAsync(0);
      const latest = node.intent.custody(16);
      expect(latest).toBe(first);
      node.clock.setSlot(1);
      node.intent.refresh();
      expect(completed).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(25);
      await latest;
      expect(node.latest().update.local.metadata.custodyGroupCount).toBe(16n);
      node.clock.setSlot(2);
      node.intent.refresh();
      await vi.advanceTimersByTimeAsync(0);
      expect(node.latest().update.local.metadata.custodyGroupCount).toBe(16n);
      expect(node.failed).not.toHaveBeenCalled();
    } finally {
      node.intent.close();
      vi.useRealTimers();
    }
  });

  it("preserves a custody target submitted while an older Status command fails", async () => {
    const node = await fixture();
    const held = defer<void>();
    node.updateStatus.mockImplementationOnce(() => held.promise);
    try {
      const status = node.intent.updateStatus(ssz.fulu.Status.defaultValue());
      const failed = expect(status).rejects.toThrow("status rejected");
      const custody = node.intent.custody(16);
      held.reject(new Error("status rejected"));
      await failed;
      await custody;
      expect(node.latest().update.local.metadata.custodyGroupCount).toBe(16n);
    } finally {
      node.intent.close();
    }
  });

  it("rejects a pending custody target and cancels its retry on close", async () => {
    const node = await fixture(false, 0, false);
    vi.useFakeTimers();
    try {
      node.applyIntent.mockRejectedValue(Object.assign(new Error("full"), {code: "NetworkCommandFull"}));
      const pending = node.intent.custody(16);
      const rejected = expect(pending).rejects.toThrow("NATIVE_NETWORK_CLOSED");
      await vi.advanceTimersByTimeAsync(0);
      node.intent.close();
      await rejected;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      node.intent.close();
      vi.useRealTimers();
    }
  });

  it("rejects a refused caller command, retains the refresh and preserves later command order", async () => {
    const node = await fixture();
    const full = Object.assign(new Error("NetworkCommandFull"), {code: "NetworkCommandFull"});
    const held = defer<void>();
    vi.useFakeTimers();
    try {
      node.updateStatus.mockImplementationOnce(() => held.promise);
      const active = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 1});
      node.clock.setSlot(1);
      node.applyIntent.mockRejectedValueOnce(full);
      const refused = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 10});
      const rejection = expect(refused).rejects.toBe(full);
      node.intent.refresh();
      held.resolve();
      await active;
      await rejection;
      expect(node.failed).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      const subscribed = node.intent.coreTopics(true);
      const updated = node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 20});
      await vi.advanceTimersByTimeAsync(25);
      await Promise.all([subscribed, updated]);
      expect(node.latest().update.local.status.headSlot).toBe(1n);
      expect(node.applyIntent.mock.calls.at(-1)?.[1]).toBe(1n);
      expect(subscriptionNames(node.latest()).some((name) => name.includes("/beacon_block/"))).toBe(true);
      expect(node.updateStatus.mock.calls.map(([status]) => status.headSlot)).toEqual([1n, 20n]);
    } finally {
      held.resolve();
      node.intent.close();
      vi.useRealTimers();
    }
  });

  it("backs off persistent refresh pressure and cancels its only retry on close", async () => {
    const node = await fixture(false, 0, false);
    const full = Object.assign(new Error("NetworkCommandFull"), {code: "NetworkCommandFull"});
    vi.useFakeTimers();
    try {
      node.applyIntent.mockRejectedValue(full);
      node.intent.refresh();
      await vi.advanceTimersByTimeAsync(75);
      expect(node.applyIntent).toHaveBeenCalledTimes(4);
      expect(node.failed).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      node.intent.close();
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(100);
      expect(node.applyIntent).toHaveBeenCalledTimes(4);
    } finally {
      node.intent.close();
      vi.useRealTimers();
    }
  });

  it("does not retry a caller-only Status refusal or an unexpected internal failure", async () => {
    const node = await fixture(false, 0, false);
    const full = Object.assign(new Error("NetworkCommandFull"), {code: "NetworkCommandFull"});
    const failure = new Error("Unexpected owner failure");
    vi.useFakeTimers();
    try {
      node.updateStatus.mockRejectedValueOnce(full);
      await expect(node.intent.updateStatus(ssz.fulu.Status.defaultValue())).rejects.toBe(full);
      await vi.advanceTimersByTimeAsync(100);
      expect(node.updateStatus).toHaveBeenCalledOnce();
      expect(node.applyIntent).not.toHaveBeenCalled();
      node.applyIntent.mockRejectedValueOnce(failure);
      node.intent.refresh();
      await vi.advanceTimersByTimeAsync(100);
      expect(node.failed).toHaveBeenCalledExactlyOnceWith(failure);
      expect(node.applyIntent).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      node.intent.close();
      vi.useRealTimers();
    }
  });

  it("coalesces pending committee batches", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    try {
      node.applyIntent.mockImplementationOnce(() => held.promise);
      const started = node.applyIntent.mock.calls.length;
      const active = node.intent.committee([{slot: 0, subnet: 0, validatorIndex: 0, isAggregator: true}], false);
      const pending = Array.from({length: 64}, (_, subnet) =>
        node.intent.committee([{slot: 1, subnet, validatorIndex: subnet, isAggregator: true}], false)
      );
      const sync = node.intent.committee(
        [{slot: 1024 * SLOTS_PER_EPOCH, subnet: 3, validatorIndex: 0, isAggregator: true}],
        true
      );
      for (const completion of pending) expect(completion).toBe(pending[0]);
      expect(sync).toBe(pending[0]);
      expect(node.applyIntent).toHaveBeenCalledTimes(started + 1);
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      await Promise.all([active, ...pending, sync]);
      expect(node.applyIntent).toHaveBeenCalledTimes(started + 2);
      expect(node.latest().demand.attnets).toEqual(new Uint8Array(8).fill(255));
      expect(node.latest().demand.syncnets).toBe(8);
    } finally {
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      node.intent.close();
    }
  });

  it("preserves ordering around coalesced batches and rolls back a refused batch", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    try {
      node.applyIntent.mockImplementationOnce(() => held.promise).mockRejectedValueOnce(new Error("batch refused"));
      const active = node.intent.coreTopics(true);
      const duty = {slot: 1, subnet: 1, validatorIndex: 0, isAggregator: true};
      const first = node.intent.committee([duty], false);
      const second = node.intent.committee([{...duty, subnet: 2}], false);
      const unsubscribing = node.intent.coreTopics(false);
      const last = node.intent.committee([{...duty, subnet: 3}], false);
      expect(second).toBe(first);
      expect(last).not.toBe(first);
      const rejected = expect(first).rejects.toThrow("batch refused");
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      await Promise.all([active, rejected, unsubscribing, last]);
      expect(subscriptionNames(node.latest()).some((name) => name.includes("/beacon_block/"))).toBe(false);
      const standing = node.latest().update.local.metadata.attnets[0];
      expect(node.latest().demand.attnets[0]).toBe(standing | (1 << 3));
      expect(node.failed).not.toHaveBeenCalled();
    } finally {
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      node.intent.close();
    }
  });

  it("rejects coalesced work at close", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    node.applyIntent.mockImplementationOnce(() => held.promise);
    const duty = {slot: 1, subnet: 1, validatorIndex: 0, isAggregator: true};
    const active = node.intent.committee([duty], false);
    const first = node.intent.committee([{...duty, subnet: 2}], false);
    const second = node.intent.committee([{...duty, subnet: 3}], false);
    expect(second).toBe(first);
    node.intent.close();
    await expect(first).rejects.toThrow("CLOSED");
    held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
    await expect(active).rejects.toThrow("CLOSED");
  });

  it("rejects a malformed batch atomically without contaminating pending demand", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    try {
      node.applyIntent.mockImplementationOnce(() => held.promise);
      const active = node.intent.coreTopics(true);
      const duty = {slot: 1, subnet: 1, validatorIndex: 0, isAggregator: true};
      const accepted = node.intent.committee([duty], false);
      duty.subnet = 2;
      const rejected = Array.from({length: 8738}, () => ({...duty}));
      rejected.push({...duty, validatorIndex: -1});
      expect(() => node.intent.committee(rejected, false)).toThrow("validator index");
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      await Promise.all([active, accepted]);
      node.applyIntent.mockRejectedValueOnce(new Error("committee refused"));
      await expect(node.intent.committee([duty], false)).rejects.toThrow("committee refused");
      await node.intent.coreTopics(false);
      expect(node.failed).not.toHaveBeenCalled();
    } finally {
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      node.intent.close();
    }
  });

  it("does not revive expired queued duties", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    try {
      node.applyIntent.mockImplementationOnce(() => held.promise);
      const active = node.intent.coreTopics(true);
      const pending = node.intent.committee([{slot: 1, subnet: 63, validatorIndex: 0, isAggregator: true}], false);
      node.clock.setSlot(4);
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      await Promise.all([active, pending]);
      expect(node.latest().demand.attnets).toEqual(node.latest().update.local.metadata.attnets);
      node.clock.setSlot(100 * SLOTS_PER_EPOCH);
      await node.intent.committee([{slot: 1, subnet: 62, validatorIndex: 0, isAggregator: true}], false);
      expect(node.latest().demand.attnets).toEqual(node.latest().update.local.metadata.attnets);
    } finally {
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      node.intent.close();
    }
  });

  it("requests peers for non-aggregator attester duties without adding a local topic join", async () => {
    const node = await fixture();
    try {
      const before = node.latest();
      const subnet = Array.from({length: 64}, (_, index) => index).find(
        (index) => (before.update.local.metadata.attnets[index >> 3] & (1 << (index % 8))) === 0
      );
      if (subnet === undefined) throw new Error("Expected an unjoined attestation subnet");
      await node.intent.committee([{slot: 2, subnet, validatorIndex: 0, isAggregator: false}], false);
      const current = node.latest();
      expect(current.demand.attnets[subnet >> 3] & (1 << (subnet % 8))).not.toBe(0);
      expect(current.update.local.metadata.attnets).toEqual(before.update.local.metadata.attnets);
      expect(subscriptionNames(current).some((name) => name.includes(`/beacon_attestation_${subnet}/`))).toBe(false);
      node.clock.setSlot(4);
      await node.intent.updateStatus(ssz.fulu.Status.defaultValue());
      expect(node.latest().demand.attnets[subnet >> 3] & (1 << (subnet % 8))).toBe(0);
    } finally {
      node.intent.close();
    }
  });

  it("maintains publication peers outside local sampling groups", async () => {
    const node = await fixture();
    try {
      const targets = node.latest().demand.groupTargets;
      const custodyTargets = node.latest().demand.custodyGroupTargets;
      const sampled = new Set(node.network.custodyConfig.sampleGroups);
      expect(sampled.size).toBeLessThan(node.config.NUMBER_OF_CUSTODY_GROUPS);
      expect(targets).toHaveLength(128);
      expect(custodyTargets).toHaveLength(128);
      for (let group = 0; group < 128; group++) {
        expect(targets[group]).toBe(group >= node.config.NUMBER_OF_CUSTODY_GROUPS ? 0 : sampled.has(group) ? 6 : 4);
        expect(custodyTargets[group]).toBe(sampled.has(group) ? 2 : 0);
      }
    } finally {
      node.intent.close();
    }
  });

  it.each([
    {maxPeers: 5, targetGroupPeers: 5},
    {maxPeers: 3, targetGroupPeers: 2},
    {maxPeers: 2, targetGroupPeers: 1},
  ])("bounds column targets by configured groups and peer capacity: %o", async ({maxPeers, targetGroupPeers}) => {
    const node = await fixture(
      false,
      0,
      true,
      {maxPeers, targetPeers: maxPeers - 1, targetGroupPeers},
      {NUMBER_OF_CUSTODY_GROUPS: 64}
    );
    try {
      const sampled = new Set(node.network.custodyConfig.sampleGroups);
      const targets = node.latest().demand.groupTargets;
      for (let group = 0; group < 128; group++) {
        expect(targets[group]).toBe(group >= 64 ? 0 : sampled.has(group) ? targetGroupPeers : Math.min(4, maxPeers));
        expect(node.latest().demand.custodyGroupTargets[group]).toBe(sampled.has(group) ? Math.min(2, maxPeers) : 0);
      }
    } finally {
      node.intent.close();
    }
  });

  it("starts column publication demand at Fulu activation", async () => {
    const node = await fixture(false, 1);
    try {
      expect(node.latest().demand.groupTargets.every((target) => target === 0)).toBe(true);
      expect(node.latest().demand.custodyGroupTargets.every((target) => target === 0)).toBe(true);
      node.clock.setSlot(SLOTS_PER_EPOCH);
      await node.intent.updateStatus(ssz.fulu.Status.defaultValue());
      expect(
        node
          .latest()
          .demand.groupTargets.slice(0, node.config.NUMBER_OF_CUSTODY_GROUPS)
          .every((target) => target >= 4)
      ).toBe(true);
      expect(node.latest().demand.custodyGroupTargets.filter((target) => target === 2)).toHaveLength(
        node.network.custodyConfig.sampleGroups.length
      );
    } finally {
      node.intent.close();
    }
  });

  it("keeps subscribe-all and custody ownership when core topics are removed", async () => {
    const node = await fixture(true);
    try {
      await node.intent.coreTopics(true);
      await node.intent.custody(16);
      await node.intent.coreTopics(false);
      const names = subscriptionNames(node.latest());
      expect(names.some((name) => name.includes("/beacon_block/"))).toBe(false);
      expect(names.filter((name) => name.includes("/beacon_attestation_"))).toHaveLength(64);
      expect(names.filter((name) => name.includes("/sync_committee_"))).toHaveLength(4);
      expect(names.some((name) => name.includes("/data_column_sidecar_"))).toBe(true);
      expect(node.latest().update.local.metadata.attnets).toEqual(new Uint8Array(8).fill(255));
      expect(node.latest().update.local.metadata.syncnets).toBe(15);
    } finally {
      node.intent.close();
    }
  });

  it("publishes each requested state only after its own native completion and rolls back failures", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    try {
      node.applyIntent.mockImplementationOnce(() => held.promise);
      const started = node.applyIntent.mock.calls.length;
      const subscribing = node.intent.coreTopics(true);
      const unsubscribing = node.intent.coreTopics(false);
      const completed = vi.fn();
      void subscribing.then(completed);
      await Promise.resolve();
      expect(completed).not.toHaveBeenCalled();
      expect(node.applyIntent.mock.calls).toHaveLength(started + 1);
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      await subscribing;
      await unsubscribing;
      expect(subscriptionNames(node.latest()).some((name) => name.includes("/beacon_block/"))).toBe(false);
      node.applyIntent.mockRejectedValueOnce(new Error("native capacity"));
      await expect(node.intent.custody(16)).rejects.toThrow("native capacity");
      await node.intent.updateStatus(ssz.fulu.Status.defaultValue());
      await node.intent.coreTopics(false);
      expect(node.latest().update.local.metadata.custodyGroupCount).toBe(BigInt(node.config.CUSTODY_REQUIREMENT));
    } finally {
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      node.intent.close();
    }
  });

  it("snapshots caller data and expires duties while preserving standing custody and sampling targets", async () => {
    const node = await fixture();
    try {
      const {groupTargets, custodyGroupTargets} = structuredClone(node.latest().demand);
      const status = ssz.fulu.Status.defaultValue();
      status.headRoot.fill(7);
      const changed = node.intent.updateStatus(status);
      status.headRoot.fill(9);
      await changed;
      expect(node.updateStatus.mock.calls.at(-1)?.[0].headRoot).toEqual(new Uint8Array(32).fill(7));
      const duty = {slot: 2, subnet: 1, validatorIndex: 0, isAggregator: true};
      await node.intent.committee([duty], false);
      expect(node.latest().update.local.status.headRoot).toEqual(new Uint8Array(32).fill(7));
      await node.intent.committee([duty], true);
      expect(subscriptionNames(node.latest()).some((name) => name.includes("/sync_committee_1/"))).toBe(true);
      node.clock.setSlot(3);
      await node.intent.updateStatus(status);
      expect(subscriptionNames(node.latest()).some((name) => name.includes("/sync_committee_1/"))).toBe(true);
      node.clock.setSlot(SLOTS_PER_EPOCH);
      await node.intent.updateStatus(status);
      expect(subscriptionNames(node.latest()).some((name) => name.includes("/sync_committee_1/"))).toBe(false);
      expect(node.latest().demand.syncnets).toBe(0);
      node.clock.setSlot(10_000 * SLOTS_PER_EPOCH);
      await node.intent.updateStatus(status);
      expect(node.latest().demand.groupTargets).toEqual(groupTargets);
      expect(node.latest().demand.custodyGroupTargets).toEqual(custodyGroupTargets);
      await node.intent.committee(
        Array.from({length: 8738}, () => duty),
        false
      );
      expect(node.latest().demand.attnets).toEqual(node.latest().update.local.metadata.attnets);
    } finally {
      node.intent.close();
    }
  });

  it("subscribes the next fork at E-2 and drops the old fork exactly at E+2", async () => {
    const node = await fixture(false, 4);
    try {
      await node.intent.coreTopics(true);
      const digest = (epoch: number) =>
        node.config.forkBoundary2ForkDigestHex(node.config.getForkBoundaryAtEpoch(epoch));
      for (const [epoch, old, next] of [
        [1, true, false],
        [2, true, true],
        [4, true, true],
        [6, false, true],
      ] as const) {
        node.clock.setSlot(epoch * SLOTS_PER_EPOCH);
        await node.intent.updateStatus(ssz.fulu.Status.defaultValue());
        const names = subscriptionNames(node.latest());
        expect(names.some((name) => name.includes(`/${digest(0)}/`))).toBe(old);
        expect(names.some((name) => name.includes(`/${digest(4)}/`))).toBe(next);
      }
    } finally {
      node.intent.close();
    }
  });

  it("uses Status-only commands within a slot and retains their acknowledged Status for full intents", async () => {
    const node = await fixture();
    try {
      await node.intent.coreTopics(true);
      await node.intent.committee([{slot: 1, subnet: 1, validatorIndex: 0, isAggregator: true}], false);
      const before = structuredClone(node.latest());
      const calls = node.applyIntent.mock.calls.length;
      const status = ssz.fulu.Status.defaultValue();
      status.headSlot = 12;
      await node.intent.updateStatus(status);
      status.headSlot = 8;
      await node.intent.updateStatus(status);
      expect(node.applyIntent).toHaveBeenCalledTimes(calls);
      expect(node.latest()).toEqual(before);
      expect(node.updateStatus.mock.calls.map(([value]) => value.headSlot)).toEqual([12n, 8n]);
      await node.intent.coreTopics(false);
      expect(node.latest().update.local.status.headSlot).toBe(8n);
      expect(node.latest().demand).toEqual(before.demand);
      expect(node.latest().update.local.metadata).toEqual(before.update.local.metadata);
    } finally {
      node.intent.close();
    }
  });

  it("orders Status and full intent acknowledgements together and rolls back rejected Status", async () => {
    const node = await fixture();
    const held = defer<void>();
    try {
      node.updateStatus.mockImplementationOnce(() => held.promise);
      const first = {...ssz.fulu.Status.defaultValue(), headSlot: 10};
      const second = {...ssz.fulu.Status.defaultValue(), headSlot: 11};
      const updating = node.intent.updateStatus(first);
      const subscribing = node.intent.coreTopics(true);
      const updatingAgain = node.intent.updateStatus(second);
      await Promise.resolve();
      expect(node.updateStatus).toHaveBeenCalledTimes(1);
      expect(node.applyIntent).toHaveBeenCalledTimes(1);
      held.resolve();
      await Promise.all([updating, subscribing, updatingAgain]);
      expect(node.latest().update.local.status.headSlot).toBe(10n);
      expect(node.updateStatus.mock.calls[1][0].headSlot).toBe(11n);
      node.updateStatus.mockRejectedValueOnce(new Error("status rejected"));
      const rejected = node.intent.updateStatus({...second, headSlot: 99});
      const removing = node.intent.coreTopics(false);
      await expect(rejected).rejects.toThrow("status rejected");
      await removing;
      expect(node.latest().update.local.status.headSlot).toBe(11n);
      expect(node.failed).not.toHaveBeenCalled();
    } finally {
      held.resolve();
      node.intent.close();
    }
  });

  it("refreshes the clock fork before Status at a new slot even when the head remains behind", async () => {
    const node = await fixture(false, 1);
    try {
      const status = {...ssz.fulu.Status.defaultValue(), headSlot: 0};
      node.clock.setSlot(SLOTS_PER_EPOCH);
      await node.intent.updateStatus(status);
      expect(node.updateStatus).not.toHaveBeenCalled();
      expect(node.applyIntent.mock.calls.at(-1)?.[1]).toBe(BigInt(SLOTS_PER_EPOCH));
      expect(node.latest().update.local).not.toHaveProperty("fork");
      expect(node.latest().update.local.status.headSlot).toBe(0n);
      expect(node.latest().update.local.status).not.toHaveProperty("forkDigest");
      const calls = node.applyIntent.mock.calls.length;
      await node.intent.updateStatus({...status, headSlot: 1});
      expect(node.applyIntent).toHaveBeenCalledTimes(calls);
      expect(node.updateStatus.mock.calls[0][0]).toMatchObject({
        earliestAvailableSlot: 0n,
        headSlot: 1n,
      });
    } finally {
      node.intent.close();
    }
  });

  it("retries a failed slot refresh before allowing a narrow Status update", async () => {
    const node = await fixture();
    try {
      node.clock.setSlot(1);
      node.applyIntent.mockRejectedValueOnce(new Error("refresh rejected"));
      await expect(node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 20})).rejects.toThrow(
        "refresh rejected"
      );
      await node.intent.coreTopics(true);
      expect(node.latest().update.local.status.headSlot).toBe(0n);
      expect(node.applyIntent.mock.calls.at(-1)?.[1]).toBe(1n);
      expect(node.updateStatus).not.toHaveBeenCalled();
      await node.intent.updateStatus({...ssz.fulu.Status.defaultValue(), headSlot: 10});
      expect(node.updateStatus).toHaveBeenCalledTimes(1);
      expect(node.updateStatus.mock.calls[0][0].headSlot).toBe(10n);
    } finally {
      node.intent.close();
    }
  });

  it("uses Status immediately after initialization and rejects malformed caller data", async () => {
    const node = await fixture(false, 0, false);
    try {
      await node.intent.updateStatus(ssz.fulu.Status.defaultValue());
      expect(node.applyIntent).not.toHaveBeenCalled();
      expect(node.updateStatus).toHaveBeenCalledOnce();
      const invalid = ssz.fulu.Status.defaultValue();
      invalid.headRoot = new Uint8Array(31);
      expect(() => node.intent.updateStatus(invalid)).toThrow("status root length");
      invalid.headRoot = new Uint8Array(32);
      invalid.headSlot = -1;
      expect(() => node.intent.updateStatus(invalid)).toThrow("head slot");
    } finally {
      node.intent.close();
    }
  });

  it("does not report an acknowledged refresh as a fatal failure after close", async () => {
    const node = await fixture(false, 0, false);
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    node.applyIntent.mockReturnValueOnce(held.promise);
    node.intent.refresh();
    node.intent.close();
    held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
    await held.promise;
    expect(node.applyIntent).toHaveBeenCalledOnce();
    expect(node.failed).not.toHaveBeenCalled();
  });

  it("rejects mixed queued commands when closed during a narrow Status acknowledgement", async () => {
    const node = await fixture();
    const held = defer<void>();
    node.updateStatus.mockImplementationOnce(() => held.promise);
    const pending = [
      node.intent.updateStatus(ssz.fulu.Status.defaultValue()),
      node.intent.coreTopics(true),
      node.intent.updateStatus(ssz.fulu.Status.defaultValue()),
    ].map((promise) => promise.catch((error: unknown) => error));
    node.intent.close();
    held.resolve();
    expect((await Promise.all(pending)).every((error) => error instanceof Error)).toBe(true);
    expect(node.updateStatus).toHaveBeenCalledTimes(1);
    expect(node.applyIntent).toHaveBeenCalledTimes(1);
  });

  it("bounds commands and rejects queued work during close without waiting for native completion", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetwork["applyIntent"]>>>();
    node.applyIntent.mockImplementationOnce(() => held.promise);
    const waiting = Array.from({length: 17}, () => node.intent.coreTopics(true).catch((error: unknown) => error));
    await expect(node.intent.coreTopics(true)).rejects.toThrow("local intent commands");
    node.intent.close();
    held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
    expect((await Promise.all(waiting)).every((error) => error instanceof Error)).toBe(true);
    await expect(node.intent.coreTopics(true)).rejects.toThrow("NATIVE_NETWORK_CLOSED");
  });
});

function subscriptionNames(intent: NativeLocalIntent): string[] {
  const names: string[] = [];
  for (const {digest, subnets} of intent.subscriptions) {
    for (const [kind, mask] of Object.entries(subnets)) {
      for (let i = 0; i < mask.length * 8; i++) {
        if (!(mask[i >> 3] & (1 << (i % 8)))) continue;
        const suffix = ["beacon_attestation", "sync_committee", "blob_sidecar", "data_column_sidecar"].includes(kind)
          ? `_${i}`
          : "";
        names.push(`/eth2/${Buffer.from(digest).toString("hex")}/${kind}${suffix}/ssz_snappy`);
      }
    }
  }
  return names;
}
