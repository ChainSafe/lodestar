import {expect, test} from "vitest";
import type {NativeApplicationConfig} from "../src/network.js";
import {applicationConfig, startRuntime} from "./utils/network.js";

test.each(["resources", "identify", "serveLightClients", "logLevel"])("rejects missing %s", (field) => {
  const config = applicationConfig();
  Reflect.deleteProperty(config, field);
  expect(() => startRuntime(config, () => undefined)).toThrow();
});

test.each([
  ["targetPeers", 256],
  ["maxPeers", 256],
  ["inboundPeersPerSourceMax", 256],
  ["receiveBudgetBytes", Number.MAX_SAFE_INTEGER],
  ["nativeBudgetBytes", 2 * 1024 ** 3],
  ["bridgeBudgetBytes", 1024 ** 3],
] as const)("rejects %s above its resource maximum", (field, maximum) => {
  const config = applicationConfig();
  config.resources[field] = maximum + 1;
  expect(() => startRuntime(config, () => undefined)).toThrow("InvalidNetworkInteger");
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "rejects native byte ceiling %s",
  (value) => {
    const config = applicationConfig();
    config.resources.nativeBudgetBytes = value;
    expect(() => startRuntime(config, () => undefined)).toThrow("InvalidNetworkInteger");
  }
);

test.each([
  (c: ReturnType<typeof applicationConfig>) => {
    Reflect.set(c, "traceGossip", 1);
  },
  (c: ReturnType<typeof applicationConfig>) => {
    Reflect.set(c.resources, "extra", 1);
  },
  (c: ReturnType<typeof applicationConfig>) => {
    Reflect.set(c, "serveLightClients", 1);
  },
  (c: ReturnType<typeof applicationConfig>) => {
    Reflect.set(c, "logLevel", "trace");
  },
  (c: ReturnType<typeof applicationConfig>) => {
    c.identify.agentVersion = "x".repeat(257);
  },
  (c: ReturnType<typeof applicationConfig>) => {
    c.identify.protocolVersion = "é".repeat(33);
  },
  (c: ReturnType<typeof applicationConfig>) => {
    c.resources.targetPeers = 13;
  },
  (c: ReturnType<typeof applicationConfig>) => {
    Reflect.set(c.local.metadata, "custodyGroupCount", null);
  },
])("rejects malformed complete application configuration %#", (mutate) => {
  const config = applicationConfig();
  mutate(config);
  expect(() => startRuntime(config, () => undefined)).toThrow();
});

test.each(["native", "bridge"])("rejects insufficient %s reservation before owner spawn", (kind) => {
  const config = applicationConfig();
  if (kind === "native") config.resources.nativeBudgetBytes = 1;
  else config.resources.bridgeBudgetBytes = 1;
  expect(() => startRuntime(config)).toThrow(
    kind === "native" ? "NetworkNativeBudgetExceeded" : "NetworkBridgeBudgetExceeded"
  );
});

test("derives retained peer capacity at the maximum peer count", async () => {
  const config = applicationConfig();
  config.resources.maxPeers = 256;
  config.resources.nativeBudgetBytes = 2 * 1024 ** 3;
  config.resources.receiveBudgetBytes = 512 * 1024 ** 2;
  const runtime = startRuntime(config);
  try {
    expect(runtime.limits.peerCapacity).toBe(512);
  } finally {
    await runtime.close();
  }
});

test.each([0, 1, 256])("configures the inbound peer source limit %s", async (limit) => {
  const config = applicationConfig();
  config.resources.inboundPeersPerSourceMax = limit;
  if (limit === 0) {
    expect(() => startRuntime(config)).toThrow("InvalidOptions");
    return;
  }
  const runtime = startRuntime(config);
  await runtime.close();
});

test.each([
  ["initialCongestionWindowPackets", 0, "InvalidNetworkConfig"],
  ["initialCongestionWindowPackets", 65, "InvalidNetworkInteger"],
  ["receiveDatagramsPerTurn", 0, "InvalidNetworkConfig"],
  ["receiveDatagramsPerTurn", 257, "InvalidNetworkInteger"],
] as const)("rejects transport %s=%s", (field, value, error) => {
  const config = applicationConfig();
  config.transport = {initialCongestionWindowPackets: 10, receiveDatagramsPerTurn: 32, [field]: value};
  expect(() => startRuntime(config, () => undefined)).toThrow(error);
});

test("accepts transport overrides and exposes their effective values", async () => {
  const config = applicationConfig();
  config.transport = {initialCongestionWindowPackets: 32, receiveDatagramsPerTurn: 128};
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
    const metrics = await runtime.getMetrics();
    expect(metrics).toContain("lodestar_quic_initial_congestion_window_packets 32");
    expect(metrics).toContain("lodestar_quic_receive_datagrams_per_turn 128");
  } finally {
    await runtime.close();
  }
});

test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
  "rejects invalid active validator count %s before starting the owner",
  (count) => {
    const config = applicationConfig();
    config.activeValidatorCount = count;
    expect(() => startRuntime(config)).toThrow(count === 0 ? "InvalidNetworkConfig" : "InvalidNetworkInteger");
  }
);

test("derives startup policy from beacon configuration and host budgets", async () => {
  const config: NativeApplicationConfig = applicationConfig();
  config.resources.nativeBudgetBytes = 2 * 1024 ** 3;
  config.gossipPolicy = {hostBytes: 64 * 1024 * 1024, hostItems: 1024, topicConcurrency: 2};
  const runtime = startRuntime(config);
  try {
    const metrics = await runtime.getMetrics();
    expect(metrics).toContain('lodestar_gossip_validation_concurrency_limit{topic="beacon_attestation"} 2\n');
    expect(metrics).toContain('lodestar_gossip_validation_concurrency_limit{topic="beacon_block"} 2\n');
  } finally {
    await runtime.close();
  }
});

test("rejects a host budget that cannot hold a maximum-sized message", () => {
  const config: NativeApplicationConfig = applicationConfig();
  config.gossipPolicy = {hostBytes: 1024};
  expect(() => startRuntime(config)).toThrow("InvalidGossipExecutionLimits");
});

test.each(["absent", "undefined", "empty"] as const)("derives default gossip policy when %s", async (policy) => {
  const config: NativeApplicationConfig = applicationConfig();
  config.resources.nativeBudgetBytes = 2 * 1024 ** 3;
  if (policy === "absent") Reflect.deleteProperty(config, "gossipPolicy");
  else config.gossipPolicy = policy === "undefined" ? undefined : {};
  const runtime = startRuntime(config);
  try {
    const metrics = await runtime.getMetrics();
    expect(metrics).toContain('lodestar_gossip_validation_concurrency_limit{topic="beacon_block"} 8\n');
    expect(metrics).toContain('lodestar_gossip_validation_concurrency_limit{topic="beacon_attestation"} 128\n');
  } finally {
    await runtime.close();
  }
});
