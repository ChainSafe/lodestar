import {createHook} from "node:async_hooks";
import {expect, test} from "vitest";
import {applicationConfig, localIntent, metricValue, startRuntime, unreachableConnect} from "./utils/network.js";
import {incomingPair} from "./utils/network-incoming.js";
import type {NetworkTestRuntime} from "./utils/network-runtime.js";

type Command = (runtime: NetworkTestRuntime) => Promise<unknown>;

test.each([
  [1, "Client shutdown"],
  [2, "Irrelevant network"],
  [3, "Internal fault/error"],
  [129, "Client has too many peers"],
  [250, "Peer score too low"],
  [251, "Peer banned this node"],
] as const)("disconnect sends Goodbye %s before closing", async (reason, label) => {
  const pair = await incomingPair();
  try {
    await pair.right.disconnect(pair.identity.peerId, reason);
    await expect
      .poll(
        async () =>
          metricValue(await pair.left.getMetrics(), `lodestar_peer_goodbye_received_total{reason="${label}"}`),
        {
          timeout: 5000,
        }
      )
      .toBe(1);
    await expect.poll(() => pair.right.observePeers().counts.connected, {timeout: 5000}).toBe(0);
  } finally {
    await Promise.allSettled([pair.left.stop(), pair.right.close()]);
  }
});

test("rejects invalid Goodbye reasons", async () => {
  const runtime = startRuntime(applicationConfig());
  try {
    for (const reason of [0, 128, -1, 2.5, 252, NaN]) {
      expect(() => runtime.disconnect(runtime.identity.peerId, reason as 1), `reason ${reason}`).toThrow();
    }
    await runtime.reStatusPeers([]);
  } finally {
    await runtime.close();
  }
});

/** Diagnostics share one result buffer, so exercise the two query kinds separately. */
function commands(): [string, [string, Command][]][] {
  const config = applicationConfig();
  const [peer, endpoints] = unreachableConnect();
  return [
    [
      "mutations and gossip diagnostics",
      [
        ["applyIntent", (runtime) => runtime.applyIntent(localIntent(config))],
        ["updateStatus", (runtime) => runtime.updateStatus(config.local.status)],
        ["getMetrics", (runtime) => runtime.getMetrics()],
        ["getGossipDiagnostics", (runtime) => runtime.getGossipDiagnostics(0)],
        ["connect", (runtime) => runtime.connect(peer, endpoints, 60000n)],
        ["disconnect", (runtime) => runtime.disconnect(peer)],
        ["reStatusPeers", (runtime) => runtime.reStatusPeers([peer])],
        ["addDirectPeer", (runtime) => runtime.addDirectPeer(peer, endpoints)],
        ["removeDirectPeer", (runtime) => runtime.removeDirectPeer(peer)],
      ],
    ],
    ["peer score diagnostics", [["getPeerScores", (runtime) => runtime.getPeerScores()]]],
  ];
}

test.each(commands())("%s settle when close races their execution", async (_, kinds) => {
  const runtime = startRuntime(applicationConfig());
  const outcomes = kinds.map(([kind, command]) =>
    command(runtime).then(
      () => `${kind} resolved`,
      (error) => `${kind} ${error.code}`
    )
  );
  const closed = runtime.close();
  const results = await Promise.all(outcomes);
  for (const [index, [kind]] of kinds.entries()) {
    const expected = [`${kind} resolved`, `${kind} NetworkClosed`];
    if (kind === "connect") expected.push("connect NetworkConnectCancelled");
    expect(expected).toContain(results[index]);
  }
  expect(await closed).toEqual({reason: "requested"});
});

test("ordinary command pressure preserves one local-state admission", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  try {
    const admitted = Array.from({length: 31}, () => runtime.getMetrics());
    expect(() => runtime.getMetrics()).toThrow("NetworkCommandFull");
    const state = runtime.applyIntent(localIntent(config));
    const refused = expect(runtime.applyIntent(localIntent(config))).rejects.toThrow("NetworkCommandFull");

    await Promise.all([...admitted, state, refused]);
    expect((await runtime.observeIdentity()).peerId).toBe(runtime.identity.peerId);
  } finally {
    // A refused command left no record, so the close result finds none missing.
    expect(await runtime.close()).toEqual({reason: "requested"});
  }
});

test("close during native Promise creation refuses admission without leaving an operation", async () => {
  const runtime = startRuntime(applicationConfig());
  let closedDuringCreation = false;
  const hook = createHook({
    init(_id, type) {
      if (type !== "PROMISE" || closedDuringCreation) return;
      closedDuringCreation = true;
      runtime.close();
    },
  });
  try {
    hook.enable();
    expect(() => runtime.reStatusPeers([])).toThrow("NetworkClosed");
  } finally {
    hook.disable();
    expect(await runtime.close()).toEqual({reason: "requested"});
  }
  expect(closedDuringCreation).toBe(true);
});
