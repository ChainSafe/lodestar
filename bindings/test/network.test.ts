import {setTimeout as delay} from "node:timers/promises";
import {privateKeyFromRaw} from "@libp2p/crypto/keys";
import {peerIdFromPublicKey} from "@libp2p/peer-id";
import {expect, it, vi} from "vitest";
import type {HostCapacity} from "../src/network.js";
import type {Feedback} from "./utils/network.js";
import {
  applicationConfig,
  childTestTimeout,
  configureChain,
  discoveryConfig,
  exchange,
  gossipAll,
  holdSettling,
  localIntent,
  requestForks,
  runChild,
  runtimeReleased,
  setSlot,
  settleOnly,
  startRuntime,
  topicName,
} from "./utils/network.js";
import {BLOCKS} from "./utils/network-incoming.js";
import {startPeer} from "./utils/network-peer.js";
import {initializeNativeNetworkRuntime} from "./utils/network-runtime.js";

function report(peerId: string): Feedback {
  return {action: "fatal", count: 1, peerId, type: "reportPeer"};
}

it("owns a real native socket and releases it on idempotent close", childTestTimeout(1, 15000), async () => {
  const config = applicationConfig();
  const expectedPeerId = peerIdFromPublicKey(privateKeyFromRaw(config.identitySecretKey).publicKey).toString();
  const runtime = startRuntime(config, () => undefined);
  const terminal = runtime.closed;
  try {
    const identity = await runtime.identity;
    expect(identity.peerId).toEqual(expectedPeerId);
    expect(typeof identity.peerId).toBe("string");
    for (const invalid of [
      "",
      "1".repeat(56),
      "x".repeat(4096),
      "not-a-peer",
      `z${identity.peerId}`,
      `${identity.peerId}\0`,
      `${identity.peerId}é`,
    ]) {
      expect(() => exchange(runtime, settleOnly, [report(invalid)])).toThrow("InvalidNetworkPeerId");
      expect(() => runtime.connect(invalid, [identity.localEndpoint], 1000n)).toThrow("InvalidNetworkPeerId");
      expect(() => runtime.reStatusPeers([invalid])).toThrow("InvalidNetworkPeerId");
      expect(() =>
        runtime.request(invalid, "/eth2/beacon_chain/req/beacon_blocks_by_root/2/ssz_snappy", new Uint8Array(0))
      ).toThrow("InvalidNetworkPeerId");
    }
    for (const invalid of [null, 1, new Uint8Array(39), {toString: () => identity.peerId}]) {
      expect(() => exchange(runtime, settleOnly, [report(invalid as unknown as string)])).toThrow(
        "InvalidNetworkPeerId"
      );
    }
    expect(identity.localEndpoint.port).toBeGreaterThan(0);
    await runtime.applyIntent(localIntent(config));
    const closing = runtime.close();
    expect(terminal).toBe(closing);
    expect(runtime.close()).toBe(closing);
    await closing;
    runChild([
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {createSocket} from 'node:dgram'; const socket = createSocket('udp4'); socket.on('error', () => process.exit(1)); socket.bind(${identity.localEndpoint.port}, '127.0.0.1', () => socket.close());`,
    ]);
  } finally {
    await runtime.close();
  }
});

it("copies inputs before returning and preserves earlier identity snapshots", async () => {
  const config = applicationConfig();
  const expected = peerIdFromPublicKey(privateKeyFromRaw(config.identitySecretKey).publicKey).toString();
  const runtime = startRuntime(config);
  const intent = {...localIntent(config), syncCommittees: [{subnet: 1, untilSlot: 200}]};
  try {
    const identity = runtime.identity;
    expect(identity.metadata.syncnets).toBe(0);
    config.identitySecretKey.fill(0);
    if (!("address" in config.bind)) throw new Error("Expected a single bind address");
    config.bind.address.fill(0);
    config.local.status.headRoot.fill(99);
    const applied = runtime.applyIntent(intent);
    intent.syncCommittees[0].subnet = 2;
    await applied;
    expect((await runtime.observeIdentity()).metadata.syncnets).toBe(2);
    expect(identity.metadata.syncnets).toBe(0);
    expect(identity.peerId).toEqual(expected);
    await runtime.applyIntent(intent);
    const updated = await runtime.observeIdentity();
    expect(updated.metadata.syncnets).toBe(6);
    await runtime.applyIntent(intent);
    expect(await runtime.observeIdentity()).toEqual(updated);
  } finally {
    await runtime.close();
  }
  await expect(runtime.applyIntent(intent)).rejects.toThrow("NetworkClosed");
}, 20000);

it("starts with long-lived subnets and accepts sparse updates after rejecting an invalid intent", async () => {
  const config = applicationConfig();
  const runtime = startRuntime(config);
  try {
    expect(
      (await runtime.getGossipDiagnostics()).topics.some((topic) => topic.subscribed && topic.topic === topicName())
    ).toBe(false);
    expect(exchange(runtime, gossipAll)).toMatchObject({
      checks: [],
      gossip: null,
      serving: [],
    });
    const intent = localIntent(config);
    await expect(runtime.applyIntent({...intent, custodyGroupCount: 0n})).rejects.toThrow("InvalidCustodyCount");
    const topic = topicName();
    intent.coreTopics = true;
    await runtime.applyIntent(intent);
    expect((await runtime.getGossipDiagnostics()).topics).toContainEqual(
      expect.objectContaining({subscribed: true, topic})
    );
  } finally {
    await runtime.close();
  }
});

it.each([
  [
    "key length",
    (c: ReturnType<typeof applicationConfig>) => {
      c.identitySecretKey = new Uint8Array(31);
    },
    "InvalidNetworkBytes",
  ],
  [
    "fractional port",
    (c: ReturnType<typeof applicationConfig>) => {
      if (!("port" in c.bind)) throw new Error("Expected a single bind address");
      c.bind.port = 0.5;
    },
    "InvalidNetworkInteger",
  ],
  [
    "infinite validator count",
    (c: ReturnType<typeof applicationConfig>) => {
      c.activeValidatorCount = Number.POSITIVE_INFINITY;
    },
    "InvalidNetworkInteger",
  ],
  [
    "unknown timer",
    (c: ReturnType<typeof applicationConfig>) => {
      Object.assign(c.gossipPolicy, {unknown: 1});
    },
    "InvalidNetworkConfig",
  ],
  [
    "missing validator count",
    (c: ReturnType<typeof applicationConfig>) => {
      Reflect.deleteProperty(c, "activeValidatorCount");
    },
    "InvalidNetworkInteger",
  ],
  [
    "negative bigint",
    (c: ReturnType<typeof applicationConfig>) => {
      c.genesisTime = -1n;
    },
    "InvalidNetworkInteger",
  ],
  [
    "overflow bigint",
    (c: ReturnType<typeof applicationConfig>) => {
      c.genesisTime = 1n << 64n;
    },
    "InvalidNetworkInteger",
  ],
  [
    "reserved syncnet",
    (c: ReturnType<typeof applicationConfig>) => {
      c.local.metadata.syncnets = 16;
    },
    "InvalidNetworkInteger",
  ],
] as const)("rejects %s before startup", (_name, mutate, code) => {
  const config = applicationConfig();
  mutate(config);
  expect(() => startRuntime(config, () => undefined)).toThrow(code);
});

it("rejects another initialization while one is live and accepts one after release", async () => {
  let runtime: ReturnType<typeof startRuntime> | null = startRuntime(applicationConfig());
  expect(typeof runtime.identity.peerId).toBe("string");
  expect(() => startRuntime(applicationConfig())).toThrow("NetworkAlreadyInitialized");
  expect((await runtime.observeIdentity()).peerId).toEqual(runtime.identity.peerId);
  await runtime.close();
  runtime = null;
  await runtimeReleased();
  const next = startRuntime(applicationConfig());
  await next.close();
});

it("joins immediately after initialization and closes idempotently", async () => {
  const runtime = startRuntime(applicationConfig());
  const closing = runtime.close();
  expect(runtime.close()).toBe(closing);
  expect(await closing).toEqual({reason: "requested"});
});

it("rejects invalid standing capacity without changing the running runtime", async () => {
  const runtime = startRuntime(applicationConfig());
  try {
    expect(() => runtime.setCapacity({...gossipAll, gossipValidation: "yes"} as unknown as HostCapacity)).toThrow(
      "InvalidNetworkConfig"
    );
    expect(exchange(runtime, settleOnly).needsAnotherExchange).toBe(false);
    expect(await runtime.observeIdentity()).toMatchObject(runtime.identity);
  } finally {
    await runtime.close();
  }
});

it.each([
  ["closed-gc", "closed-gc-rebound"],
  ["open", "open-until-close"],
  ["promises", "promises-settled"],
  ["await-close", "close-awaited"],
])("finishes bounded %s subprocess lifecycle", childTestTimeout(), (mode, expected) => {
  const output = runChild(["--import", "tsx", "--expose-gc", "bindings/test/fixtures/network-lifecycle.mjs", mode]);
  expect(output).toContain(expected);
});

it.each([
  ["saturated-close", "saturated-closed"],
  ["finalized-drain", "finalized-drained"],
])(
  "closes through the completion owner in the bounded %s subprocess lifecycle",
  childTestTimeout(),
  (mode, expected) => {
    const output = runChild(["--import", "tsx", "--expose-gc", "bindings/test/fixtures/network-lifecycle.mjs", mode]);
    expect(output).toContain(expected);
  }
);

it("keeps queued records and closes after an ordinary callback exception", childTestTimeout(), () => {
  const output = runChild([
    "--import",
    "tsx",
    "--expose-gc",
    "--force-node-api-uncaught-exceptions-policy",
    "bindings/test/fixtures/network-lifecycle.mjs",
    "callback",
  ]);
  expect(output).toContain("callback-closed");
});

it("notifies again after a callback that throws before scheduling an exchange", childTestTimeout(), () => {
  const output = runChild([
    "--import",
    "tsx",
    "--force-node-api-uncaught-exceptions-policy",
    "bindings/test/fixtures/network-lifecycle.mjs",
    "rearm",
  ]);
  expect(output).toContain("rearmed");
});

it("releases live requests, incoming cells and gossip batches on worker termination", childTestTimeout(), () => {
  const output = runChild(["--import", "tsx", "bindings/test/fixtures/network-worker-resources.mjs"]);
  expect(output).toContain("live-worker-resources-released");
});

it("exits sequential workers that alone loaded the addon after running a runtime", childTestTimeout(), () => {
  const output = runChild(["--import", "tsx", "bindings/test/fixtures/network-worker-unload.mjs"]);
  expect(output).toContain("workers-exited 0,0,0");
});

it("rejects initialization from another Node environment", async () => {
  const {Worker} = await import("node:worker_threads");
  const runtime = startRuntime(applicationConfig());
  const worker = new Worker(new URL("./fixtures/network-worker.mjs", import.meta.url), {execArgv: ["--import", "tsx"]});
  try {
    const failure = await new Promise<Error>((resolve) => worker.once("error", resolve));
    expect(failure.message).toContain("NetworkAlreadyInitialized");
    expect((await runtime.observeIdentity()).peerId).toEqual(runtime.identity.peerId);
  } finally {
    await worker.terminate();
    await runtime.close();
  }
});

const terminations = 8;
it(
  "memory_safety: terminates workers while publication and command results are pending",
  childTestTimeout(terminations),
  () => {
    for (let i = 0; i < terminations; i++) {
      const output = runChild(["--import", "tsx", "bindings/test/fixtures/network-worker-settlement.mjs"]);
      expect(output, `worker termination ${i}`).toContain("worker-settlement-released");
    }
  }
);

it("rejects initialization of a closed raw runtime", async () => {
  const {networkBindings: addon} = await import("./utils/network-bindings.js");
  const raw = new addon.NativeNetworkRuntime();
  raw.close();
  expect(() => raw.initialize(applicationConfig(), () => undefined)).toThrow("NetworkClosed");
});

it("initializes signed discovery without waiting for bootstrap reachability", async () => {
  const config = applicationConfig();
  config.discovery = {
    advertisement: {ip4: Uint8Array.of(127, 0, 0, 1), udp: 40404},
    bind: {address: Uint8Array.of(127, 0, 0, 1), family: 4, port: 0},
    bootstrapEnrs: [],
    fixed: {ip4: Uint8Array.of(127, 0, 0, 1), quic: 443, udp: 40404},
    sequenceNumber: 7n,
  };
  const first = startRuntime(config, () => undefined);
  try {
    const identity = await first.identity;
    expect(identity.localEnr).toBeInstanceOf(Uint8Array);
    const enr = identity.localEnr;
    if (!enr) throw new Error("Missing ENR");
    expect(Buffer.from(enr).includes(Buffer.from([0x84, 0x71, 0x75, 0x69, 0x63, 0x82, 0x01, 0xbb]))).toBe(true);
    const secondConfig = applicationConfig();
    secondConfig.identitySecretKey[31] = 2;
    secondConfig.discovery = {...config.discovery, bootstrapEnrs: [enr.slice()]};
    const second = await startPeer(secondConfig);
    secondConfig.discovery.bootstrapEnrs[0].fill(0);
    try {
      const secondIdentity = await second.identity;
      expect(secondIdentity.localEnr).toBeInstanceOf(Uint8Array);
    } finally {
      await second.stop();
    }
  } finally {
    await first.close();
  }
}, 20000);

it.each([17, 64])(
  "accepts a bounded discovery bootstrap list of %i entries",
  async (count) => {
    const source = await startPeer(discoveryConfig());
    const enr = source.identity.localEnr;
    await source.stop();
    if (!enr) throw new Error("Missing ENR");
    const config = discoveryConfig();
    config.identitySecretKey[31] = 2;
    config.discovery.bootstrapEnrs = Array.from({length: count}, () => enr.slice());
    const runtime = startRuntime(config);
    try {
      expect(runtime.identity.localEnr).toBeInstanceOf(Uint8Array);
    } finally {
      await runtime.close();
    }
  },
  20000
);

it("starts wildcard discovery without advertised addresses", async () => {
  const config = applicationConfig();
  if (!("address" in config.bind)) throw new Error("Expected a single bind address");
  config.bind.address.fill(0);
  config.discovery = {
    advertisement: null,
    bind: {address: new Uint8Array(4), family: 4, port: 0},
    bootstrapEnrs: [],
    fixed: {},
    sequenceNumber: 1n,
  };
  const runtime = startRuntime(config);
  try {
    const identity = await runtime.observeIdentity();
    expect(identity.localEnr).toBeInstanceOf(Uint8Array);
    const intent = localIntent(config);
    intent.syncCommittees = [{subnet: 0, untilSlot: 200}];
    await runtime.applyIntent(intent);
    expect((await runtime.observeIdentity()).localEnr).not.toEqual(identity.localEnr);
  } finally {
    await runtime.close();
  }
}, 20000);

it("publishes copied peer observations without repeating unread notifications", async () => {
  const {Child} = await import("../../test/interop/child.mjs");
  const {multiaddr} = await import("@multiformats/multiaddr");
  const {setTimeout: delay} = await import("node:timers/promises");
  const config = applicationConfig();
  setSlot(config, 0x08070605n);
  configureChain(config, {BLOB_SCHEDULE: [], ELECTRA_FORK_EPOCH: Infinity, FULU_FORK_EPOCH: Infinity});
  config.local.status.headSlot = 0x08070605n;
  config.local.status.finalizedEpoch = 0x01020304n;
  config.local.status.finalizedRoot = Uint8Array.from({length: 32}, (_, i) => i);
  config.local.status.headRoot = Uint8Array.from({length: 32}, (_, i) => 255 - i);
  let notifications = 0;
  let workAvailable: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    workAvailable = resolve;
  });
  const runtime = startRuntime(config, () => {
    notifications++;
    workAvailable();
  });
  const remote = new Child("native-runtime-peer", process.execPath, [
    "--import",
    "tsx",
    "test/interop/libp2p_peer.mjs",
    "v12",
    "control",
    Buffer.from(requestForks[0].digest).toString("hex"),
  ]);
  try {
    const identity = await runtime.identity;
    holdSettling(runtime, true);
    runtime.setCapacity(gossipAll);
    runtime.exchange();
    const address = multiaddr(identity.localMultiaddr).toString();
    await remote.command("dial", {address});
    await remote.command("control", {address, protocol: "/eth2/beacon_chain/req/status/1/ssz_snappy"});
    await Promise.race([
      pending,
      delay(3000).then(async () => {
        throw new Error(
          `Peer observation timeout ${await runtime.getMetrics()} remote=${JSON.stringify(await remote.command("controlSnapshot"))}`
        );
      }),
    ]);
    const before = notifications;
    await delay(250);
    expect(notifications).toBe(before);
    const result = exchange(runtime, {...gossipAll});
    expect(Object.getOwnPropertyDescriptor(result, "peers")).toMatchObject({
      configurable: true,
      enumerable: true,
      value: result.peers,
      writable: true,
    });
    expect(Object.getOwnPropertyDescriptor(result.peers, "0")?.value).toBe(result.peers[0]);
    expect(Object.getOwnPropertyDescriptor(result.peers[0], "type")?.value).toBe(result.peers[0].type);
    const ready = result.peers.find((event) => event.type === "ready");
    expect(ready).toBeDefined();
    if (!ready || ready.type !== "ready") throw new Error("Missing peerReady");
    expect(ready.state).not.toHaveProperty("peer");
    expect(typeof ready.state.identity).toBe("string");
    const retained = ready.state.identity.slice();
    holdSettling(runtime, false);
    await runtime.close();
    expect(ready.state.identity).toEqual(retained);
  } finally {
    await remote.stop();
    holdSettling(runtime, false);
    await runtime.close();
  }
}, 20000);

it("rejects a bootstrap with an invalid signature before starting", async () => {
  const config = discoveryConfig();
  const source = await startPeer(config);
  const corrupt = source.identity.localEnr;
  await source.stop();
  if (!corrupt) throw new Error("Missing ENR");
  corrupt[6] ^= 1;
  config.discovery.bootstrapEnrs = [corrupt];
  expect(() => startRuntime(config)).toThrow("InvalidSignature");
}, 20000);

it("settles results only in an exchange and notifies once until an exchange finds nothing queued", async () => {
  const config = applicationConfig();
  let notifications = 0;
  const runtime = initializeNativeNetworkRuntime(config, () => {
    notifications++;
  });
  const drain = () => exchange(runtime, settleOnly).needsAnotherExchange;
  const watch = (promise: Promise<unknown>) => {
    let settled = false;
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    return () => settled;
  };
  const closing = watch(runtime.closed);
  try {
    const intent = runtime.applyIntent(localIntent(config));
    const intentSettled = watch(intent);
    await vi.waitFor(() => expect(notifications).toBe(1));
    const query = runtime.getPeerScores();
    await delay(100);
    expect(notifications).toBe(1);
    expect(intentSettled()).toBe(false);
    const querySettled = watch(query);
    expect(exchange(runtime, settleOnly).needsAnotherExchange).toBe(false);
    await delay(0);
    expect([intentSettled(), querySettled()]).toEqual([true, true]);
    expect(exchange(runtime, settleOnly)).toMatchObject({checks: [], gossip: null, peers: [], serving: []});
    await intent;
    expect((await query).peers).toEqual([]);
    const pull = runtime.request(runtime.identity.peerId, BLOCKS, new Uint8Array(32)).next();
    const pullSettled = watch(pull);
    // Native notifies once its outcome is due, and the pull itself schedules nothing.
    await vi.waitFor(() => expect(notifications).toBe(2));
    await delay(20);
    expect(pullSettled()).toBe(false);
    for (let pass = 0; pass < 8 && drain(); pass++);
    await expect(pull).rejects.toMatchObject({reason: "disconnected"});
  } finally {
    runtime.close();
    for (let i = 0; i < 400 && !closing(); i++) {
      await delay(5);
      drain();
    }
  }
  expect(await runtime.closed).toEqual({reason: "requested"});
  expect(exchange(runtime, settleOnly)).toMatchObject({needsAnotherExchange: false});
}, 20000);
