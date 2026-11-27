import {setTimeout as delay} from "node:timers/promises";
import {expect, test} from "vitest";
import type {NativeGossipDependencyCheck, NativeGossipHandle, NativeGossipVerdict} from "../src/network-types.js";
import type {Feedback} from "./utils/network.js";
import {
  applicationConfig,
  exchange,
  gossipAll,
  gossipUrgent,
  localIntent,
  metricValue,
  settleOnly,
  startRuntime,
  topicName,
  waitForGossipReady,
} from "./utils/network.js";
import {incomingPair} from "./utils/network-incoming.js";
import type {NetworkTestRuntime} from "./utils/network-runtime.js";

const BLOCK = topicName();
const ATTESTATION = topicName("beacon_attestation_0");

function classify(handle: NativeGossipHandle, available: boolean): Feedback {
  return {available, handle, type: "classify"};
}
function verdict(handle: NativeGossipHandle, value: NativeGossipVerdict): Feedback {
  return {handle, type: "verdict", verdict: value};
}

test("direct feedback validates roots, handles and verdicts, and stale handles apply as no-ops", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    await runtime.applyIntent(localIntent(config));
    expect(exchange(runtime, gossipUrgent)).toMatchObject({checks: [], gossip: null});
    const handle = {generation: 1n, index: 0};
    for (const [invalid, code] of [
      [{root: new Uint8Array(31), type: "block"}, "InvalidNetworkBytes"],
      [classify({...handle, generation: 0n}, true), "InvalidGossipHandle"],
      [classify({...handle, index: 65535}, true), "InvalidNetworkInteger"],
      [{...verdict(handle, "accept"), verdict: "ACCEPT"}, "InvalidGossipVerdict"],
      [{action: "bad", count: 1, peerId: runtime.identity.peerId, type: "reportPeer"}, "InvalidNetworkAction"],
      [
        {action: "fatal", context: {reason: "invented"}, count: 1, peerId: runtime.identity.peerId, type: "reportPeer"},
        "InvalidNetworkAction",
      ],
      [
        {
          action: "fatal",
          context: {origin: {connection: {generation: -1, index: 0}, endpoint: null}},
          count: 1,
          peerId: runtime.identity.peerId,
          type: "reportPeer",
        },
        "InvalidNetworkInteger",
      ],
      [
        {
          action: "fatal",
          context: {
            origin: {
              connection: {generation: 1, index: 0},
              endpoint: {address: new Uint8Array(3), family: 4, port: 9000},
            },
          },
          count: 1,
          peerId: runtime.identity.peerId,
          type: "reportPeer",
        },
        "InvalidNetworkBytes",
      ],
    ] as const)
      expect(() => exchange(runtime, settleOnly, [classify(handle, true), invalid as Feedback])).toThrow(code);
    expect(
      exchange(runtime, settleOnly, [classify(handle, true), verdict(handle, "ignore")]).needsAnotherExchange
    ).toBe(false);
  } finally {
    await runtime.close();
  }
});

async function checks(runtime: NetworkTestRuntime, count: number) {
  const result: NativeGossipDependencyCheck[] = [];
  for (let i = 0; i < 1000 && result.length < count; i++) {
    const delivery = exchange(runtime, gossipUrgent);
    expect(delivery.gossip).toBeNull();
    expect(delivery.serving).toEqual([]);
    result.push(...delivery.checks);
    if (result.length < count) await delay(5);
  }
  expect(result).toHaveLength(count);
  return result;
}

test("native processor retains dependencies, protects blocks, batches ready work and bounds future slots", async () => {
  const pair = await incomingPair(undefined, undefined, (left, right) => {
    for (const config of [left, right])
      config.subscriptions = {slotsToSubscribeBeforeAggregatorDuty: 2, subscribeAllSubnets: true, targetGroupPeers: 6};
  });
  try {
    for (const [runtime, config] of [
      [pair.left, pair.leftConfig],
      [pair.right, pair.rightConfig],
    ] as const) {
      const intent = localIntent(config);
      intent.coreTopics = true;
      await runtime.applyIntent(intent);
    }
    await Promise.all([
      pair.left.addDirectPeer(pair.remote.peerId, [pair.remote.localEndpoint]),
      pair.right.addDirectPeer(pair.identity.peerId, [pair.identity.localEndpoint]),
    ]);
    await Promise.all([
      waitForGossipReady(pair.left, [pair.remote.peerId], [BLOCK, ATTESTATION], () => pair.left.getMetrics()),
      waitForGossipReady(pair.right, [pair.identity.peerId], [BLOCK, ATTESTATION], () => pair.right.getMetrics()),
    ]);
    const data = new Uint8Array(229);
    const view = new DataView(data.buffer);
    view.setUint32(0, 228, true);
    view.setBigUint64(4, 100n, true);
    data.fill(7, 20, 52);
    data[228] = 1;
    const root = data.slice(20, 52);
    exchange(pair.right, {...gossipAll});
    for (const signature of [1, 2]) {
      data[132] = signature;
      await pair.left.publishGossip(ATTESTATION, data);
    }
    const waiting = await checks(pair.right, 2);
    for (const check of waiting) expect(check.root).toEqual(root);
    // Direct calls apply in order; a malformed later handle still throws.
    expect(() =>
      exchange(pair.right, settleOnly, [
        classify(waiting[0].handle, false),
        classify({...waiting[1].handle, generation: 0n}, false),
      ])
    ).toThrow("InvalidGossipHandle");

    exchange(pair.right, settleOnly, [
      classify({generation: 1n, index: 65534}, false),
      ...waiting.map(({handle}) => classify(handle, false)),
    ]);

    const blockBytes = new Uint8Array(4000);
    new DataView(blockBytes.buffer).setBigUint64(100, 100n, true);
    await pair.left.publishGossip(BLOCK, blockBytes);
    const urgent = {...gossipUrgent};
    let block;
    for (let i = 0; i < 1000 && !block; i++) {
      // Waiting attestations are neither checkable nor claimable. The block queues without a check of its parent,
      // which the host's validator checks.
      const {checks: pending, gossip} = exchange(pair.right, urgent);
      expect(pending).toEqual([]);
      if (!gossip) await delay(5);
      else {
        expect(gossip.jobs).toEqual([{grouped: false, kind: "beacon_block", length: 1, start: 0}]);
        block = gossip.messages[0];
      }
    }
    expect(block?.topic).toBe(BLOCK);
    if (!block) throw Error("Block dispatch deadline");
    expect(exchange(pair.right, urgent).gossip).toBeNull();
    exchange(pair.right, settleOnly, [verdict(block.handle, "accept"), {root, type: "block"}]);

    exchange(
      pair.right,
      settleOnly,
      (await checks(pair.right, 2)).map(({handle}) => classify(handle, true))
    );
    // The owner readies the attestation group at its deadline; claims before it find none.
    const ordinary = {...gossipAll};
    let batch = exchange(pair.right, ordinary).gossip;
    for (let i = 0; i < 200 && !batch?.messages.length; i++) {
      await delay(5);
      const result = exchange(pair.right, ordinary);
      expect(result.checks).toEqual([]);
      batch = result.gossip;
    }
    if (!batch) throw Error("Attestation group deadline");
    expect(batch.jobs).toEqual([{grouped: true, kind: "beacon_attestation", length: batch.messages.length, start: 0}]);
    expect(exchange(pair.right, ordinary).gossip).toBeNull();
    expect(batch.messages).toHaveLength(2);
    expect(batch.messages.map((message) => message.attestationData)).toEqual([
      Buffer.from(data.subarray(4, 132)).toString("base64"),
      Buffer.from(data.subarray(4, 132)).toString("base64"),
    ]);
    exchange(
      pair.right,
      settleOnly,
      batch.messages.map(({handle}) => verdict(handle, "ignore"))
    );

    view.setBigUint64(4, 999999999n, true);
    await pair.left.publishGossip(ATTESTATION, data);
    await expect
      .poll(
        async () =>
          metricValue(
            await pair.right.getMetrics(),
            'lodestar_gossip_validation_refusals_total{topic="beacon_attestation",reason="ineligible"}'
          ),
        {timeout: 5000}
      )
      .toBe(1);
    expect(exchange(pair.right, {...gossipUrgent}).checks).toEqual([]);

    view.setBigUint64(4, 100n, true);
    data[132] = 9;
    await pair.left.publishGossip(ATTESTATION, data);
    const [pending] = await checks(pair.right, 1);
    exchange(pair.right, settleOnly, [classify(pending.handle, false)]);
    const waitingMetric = 'lodestar_gossip_validation_waiting_block_count{topic="beacon_attestation"}';
    expect(metricValue(await pair.right.getMetrics(), waitingMetric)).toBe(1);
    exchange(pair.right, settleOnly, [{action: "fatal", count: 1, peerId: pair.identity.peerId, type: "reportPeer"}]);
    await expect.poll(async () => metricValue(await pair.right.getMetrics(), waitingMetric), {timeout: 5000}).toBe(0);
    expect(exchange(pair.right, gossipAll)).toMatchObject({checks: [], gossip: null});
  } finally {
    await Promise.allSettled([pair.left.stop(), pair.right.close()]);
  }
}, 30000);
