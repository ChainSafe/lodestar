import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it, vi} from "vitest";
import {NativeNetworkApplicationRuntime} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {createNativeConfig} from "../../../../src/network/core/native/config.js";
import {NativeIntent} from "../../../../src/network/core/native/intent.js";
import {defaultNetworkOptions} from "../../../../src/network/options.js";
import {ClockStopped} from "../../../mocks/clock.js";

async function fixture(subscribeAllSubnets = false, fuluEpoch = 0) {
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
    },
    new Uint8Array(32)
  );
  const opts = {
    ...defaultNetworkOptions,
    tcp: false,
    localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"],
    subscribeAllSubnets,
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
  const applyIntent = vi.fn<NativeNetworkApplicationRuntime["applyIntent"]>(async (_intent, slot) => ({
    slot,
    ownerSequence: 1n,
    changed: true,
  }));
  const failed = vi.fn();
  const intent = new NativeIntent({applyIntent}, application, network, clock, opts, 16, status, failed);
  await intent.activate(status, config.CUSTODY_REQUIREMENT);
  return {
    config,
    clock,
    applyIntent,
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
  it("keeps subscribe-all and custody ownership when core topics are removed", async () => {
    const node = await fixture(true);
    try {
      await node.intent.coreTopics(true);
      await node.intent.custody(16);
      await node.intent.coreTopics(false);
      const names = node.latest().subscriptions.map(({name}) => name);
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
    const held = defer<Awaited<ReturnType<NativeNetworkApplicationRuntime["applyIntent"]>>>();
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
      expect(node.latest().subscriptions.some(({name}) => name.includes("/beacon_block/"))).toBe(false);
      node.applyIntent.mockRejectedValueOnce(new Error("native capacity"));
      await expect(node.intent.custody(16)).rejects.toThrow("native capacity");
      await node.intent.updateStatus(ssz.fulu.Status.defaultValue());
      expect(node.latest().update.local.metadata.custodyGroupCount).toBe(BigInt(node.config.CUSTODY_REQUIREMENT));
    } finally {
      held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
      node.intent.close();
    }
  });

  it("snapshots caller data and expires aggregator and sync duties at their respective boundaries", async () => {
    const node = await fixture();
    try {
      const status = ssz.fulu.Status.defaultValue();
      status.headRoot.fill(7);
      const changed = node.intent.updateStatus(status);
      status.headRoot.fill(9);
      await changed;
      expect(node.latest().update.local.status.headRoot).toEqual(new Uint8Array(32).fill(7));
      const duty = {slot: 2, subnet: 1, validatorIndex: 0, isAggregator: true};
      await node.intent.committee([duty], false);
      await node.intent.committee([duty], true);
      expect(node.latest().subscriptions.some(({name}) => name.includes("/sync_committee_1/"))).toBe(true);
      node.clock.setSlot(3);
      await node.intent.updateStatus(status);
      expect(node.latest().subscriptions.some(({name}) => name.includes("/sync_committee_1/"))).toBe(true);
      node.clock.setSlot(SLOTS_PER_EPOCH);
      await node.intent.updateStatus(status);
      expect(node.latest().subscriptions.some(({name}) => name.includes("/sync_committee_1/"))).toBe(false);
      expect(() =>
        node.intent.committee(
          Array.from({length: 4097}, () => duty),
          false
        )
      ).toThrow("committee subscriptions");
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
        const names = node.latest().subscriptions.map(({name}) => name);
        expect(names.some((name) => name.includes(`/${digest(0)}/`))).toBe(old);
        expect(names.some((name) => name.includes(`/${digest(4)}/`))).toBe(next);
      }
    } finally {
      node.intent.close();
    }
  });

  it("bounds waiters and rejects queued work during close without waiting for native completion", async () => {
    const node = await fixture();
    const held = defer<Awaited<ReturnType<NativeNetworkApplicationRuntime["applyIntent"]>>>();
    node.applyIntent.mockImplementationOnce(() => held.promise);
    const waiting = Array.from({length: 17}, () => node.intent.coreTopics(true).catch((error: unknown) => error));
    await expect(node.intent.coreTopics(true)).rejects.toThrow("local intent waiters");
    node.intent.close();
    held.resolve({slot: 0n, ownerSequence: 2n, changed: true});
    expect((await Promise.all(waiting)).every((error) => error instanceof Error)).toBe(true);
    await expect(node.intent.coreTopics(true)).rejects.toThrow("NATIVE_NETWORK_CLOSED");
  });
});
