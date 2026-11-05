import {expect, it} from "vitest";
import bindings from "../src/index.js";
import type {NativeApplicationConfig} from "../src/network.js";
import {applicationConfig, configureChain, discoveryConfig, setSlot, startRuntime} from "./utils/network.js";

const cases: readonly [string, (config: ReturnType<typeof applicationConfig>) => void, string][] = [
  [
    "invalid Xray endpoint",
    (c) => {
      c.xray = {address: "127.0.0.1:0", waitForAttach: false};
    },
    "InvalidXrayAddress",
  ],
  [
    "missing BeaconConfig",
    (c) => {
      Reflect.deleteProperty(c, "beaconConfig");
    },
    "TypeMismatch",
  ],
  [
    "null BeaconConfig",
    (c) => {
      Object.assign(c, {beaconConfig: null});
    },
    "TypeMismatch",
  ],
  [
    "plain object instead of BeaconConfig",
    (c) => {
      Object.assign(c, {beaconConfig: {}});
    },
    "TypeMismatch",
  ],
  [
    "forged BeaconConfig instance",
    (c) => {
      Object.assign(c, {beaconConfig: Object.create(bindings.BeaconConfig.prototype)});
    },
    "TypeMismatch",
  ],
  [
    "unaligned receive buffer",
    (c) => {
      c.gossipPolicy.receiveBufferBytes = 16 * 1024 * 1024 + 1;
    },
    "InvalidNetworkConfig",
  ],
  [
    "receive buffer smaller than a legal frame",
    (c) => {
      c.gossipPolicy.receiveBufferBytes = 4096;
    },
    "InvalidNetworkConfig",
  ],
  [
    "zero large frame timeout",
    (c) => {
      c.gossipPolicy.largeFrameTimeoutMs = 0n;
    },
    "InvalidNetworkConfig",
  ],
  [
    "nonobject policy",
    (c) => {
      Object.assign(c, {gossipPolicy: null});
    },
    "InvalidNetworkConfig",
  ],
  [
    "array policy",
    (c) => {
      Object.assign(c, {gossipPolicy: []});
    },
    "InvalidNetworkConfig",
  ],
  [
    "wrong byte array type",
    (c) => {
      Object.assign(c, {identitySecretKey: new Uint16Array(32)});
    },
    "InvalidNetworkBytes",
  ],
  [
    "short status root",
    (c) => {
      c.local.status.headRoot = new Uint8Array(31);
    },
    "InvalidNetworkBytes",
  ],
  [
    "IPv4 bytes for IPv6 endpoint",
    (c) => {
      Object.assign(c.bind, {family: 6});
    },
    "InvalidNetworkBytes",
  ],
  [
    "unsupported endpoint family",
    (c) => {
      Object.assign(c.bind, {family: 5});
    },
    "InvalidNetworkConfig",
  ],
  [
    "mapped IPv6 listener",
    (c) => {
      c.bind = {address: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1), family: 6, port: 0};
    },
    "InvalidNetworkConfig",
  ],
  [
    "mapped IPv6 dual listener",
    (c) => {
      c.bind = [
        {address: Uint8Array.of(127, 0, 0, 1), family: 4, port: 0},
        {address: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1), family: 6, port: 0},
      ];
    },
    "InvalidNetworkConfig",
  ],
  [
    "mapped IPv6 discovery listener",
    (c) => {
      c.discovery = {
        ...discoveryConfig().discovery,
        bind: {address: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1), family: 6, port: 0},
      };
    },
    "InvalidNetworkConfig",
  ],
  [
    "mapped IPv6 advertisement with IPv6 listeners",
    (c) => {
      const bind = {
        address: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1),
        family: 6 as const,
        port: 0,
      };
      c.bind = bind;
      c.discovery = {
        ...discoveryConfig().discovery,
        bind,
        fixed: {
          ip6: Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 127, 0, 0, 1),
          quic6: 9001,
          udp6: 9000,
        },
      };
    },
    "InvalidNetworkConfig",
  ],
  [
    "unsafe numeric port",
    (c) => {
      Object.assign(c.bind, {port: Number.MAX_SAFE_INTEGER + 1});
    },
    "InvalidNetworkInteger",
  ],
  [
    "Number instead of BigInt",
    (c) => {
      Object.assign(c, {genesisTime: 100});
    },
    "InvalidNetworkInteger",
  ],
  [
    "zero active send capacity",
    (c) => {
      c.gossipPolicy.activeSendItems.beacon_block = 0;
    },
    "InvalidNetworkConfig",
  ],
  [
    "custody count over local limit",
    (c) => {
      c.local.metadata.custodyGroupCount = 129n;
    },
    "InvalidCustodyCount",
  ],
  [
    "too many bootstraps",
    (c) => {
      c.discovery = {...discoveryConfig().discovery, bootstrapEnrs: Array.from({length: 65}, () => Uint8Array.of(1))};
    },
    "InvalidNetworkConfig",
  ],
  [
    "oversized bootstrap",
    (c) => {
      c.discovery = {...discoveryConfig().discovery, bootstrapEnrs: [new Uint8Array(301)]};
    },
    "InvalidNetworkBytes",
  ],
  [
    "empty bootstrap",
    (c) => {
      c.discovery = {...discoveryConfig().discovery, bootstrapEnrs: [new Uint8Array(0)]};
    },
    "InvalidNetworkBytes",
  ],
];

it.each(cases)("rejects %s before acquiring native thread or socket ownership", (_name, mutate, code) => {
  const config = applicationConfig();
  mutate(config);
  expect(() => startRuntime(config, () => undefined)).toThrow(code);
});

it("rejects a noncanonical bootstrap encoding during ordinary owner startup", async () => {
  const config = discoveryConfig();
  if (!config.discovery) throw new Error("Missing discovery config");
  config.discovery.bootstrapEnrs = [Uint8Array.of(0xf8, 0x00)];
  expect(() => startRuntime(config, () => undefined)).toThrow("InvalidRecord");
});

it("accepts sparse operator policy with native defaults", async () => {
  const config: NativeApplicationConfig = applicationConfig();
  config.traceGossip = undefined;
  config.gossipPolicy = {activeSendTimeoutMs: 4000n, hostItems: undefined};
  config.transport = {receiveDatagramsPerTurn: 64};
  config.resources.nativeBudgetBytes = undefined;
  config.subscriptions = {slotsToSubscribeBeforeAggregatorDuty: 64, subscribeAllSubnets: false, targetGroupPeers: 6};
  const runtime = startRuntime(config, () => undefined);
  try {
    await runtime.identity;
  } finally {
    await runtime.close();
  }
});

it.each([
  ["unknown wire field", {iwantDeadline: 12000n}, "InvalidNetworkConfig"],
  ["numeric interval", {activeSendTimeoutMs: 12000}, "InvalidNetworkInteger"],
  ["zero interval", {activeSendTimeoutMs: 0n}, "InvalidNetworkConfig"],
  ["large interval", {activeSendTimeoutMs: 86400001n}, "InvalidNetworkConfig"],
  ["negative interval", {activeSendTimeoutMs: -1n}, "InvalidNetworkInteger"],
  ["bigint receive bytes", {receiveBufferBytes: 128n}, "InvalidNetworkInteger"],
  ["fractional receive bytes", {receiveBufferBytes: 1.5}, "InvalidNetworkInteger"],
  ["unsafe receive bytes", {receiveBufferBytes: Number.MAX_SAFE_INTEGER + 1}, "InvalidNetworkInteger"],
  ["negative receive bytes", {receiveBufferBytes: -1}, "InvalidNetworkInteger"],
  ["large receive bytes", {receiveBufferBytes: 2 * 1024 * 1024 * 1024}, "InvalidNetworkInteger"],
] as const)("rejects %s wire policy before startup", (_name, fields, code) => {
  const config = applicationConfig();
  Object.assign(config.gossipPolicy, fields);
  expect(() => startRuntime(config, () => undefined)).toThrow(code);
});

it.each([0, 129])("rejects chain custody group bound %s", (groups) => {
  const config = applicationConfig();
  configureChain(config, {NUMBER_OF_CUSTODY_GROUPS: groups});
  expect(() => startRuntime(config, () => undefined)).toThrow("InvalidNetworkChain");
});

it.each([0, 1, 1_000_000])("rejects an active unsupported fork at epoch %s before owner allocation", (epoch) => {
  const config = applicationConfig();
  configureChain(config, {ELECTRA_FORK_EPOCH: 0, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: 0, HEZE_FORK_EPOCH: epoch});
  setSlot(config, BigInt(epoch) * 32n);
  expect(() => startRuntime(config)).toThrow("UnsupportedNetworkFork");
});

it("starts with a future unsupported fork scheduled", async () => {
  const config = applicationConfig();
  configureChain(config, {GLOAS_FORK_EPOCH: 1_000_000, HEZE_FORK_EPOCH: 2_000_000});
  const runtime = startRuntime(config);
  await runtime.close();
});

it.each([0, 2000])("requires availability from startup with Fulu scheduled at epoch %s", (epoch) => {
  const config = applicationConfig();
  configureChain(config, {ELECTRA_FORK_EPOCH: 0, FULU_FORK_EPOCH: epoch});
  config.local.status.earliestAvailableSlot = null;
  expect(() => startRuntime(config, () => undefined)).toThrow("MissingAvailability");
});

it("selects its BeaconConfig independently of later configurations", async () => {
  const config = applicationConfig();
  const other = applicationConfig();
  configureChain(other, {ELECTRA_FORK_EPOCH: 0, FULU_FORK_EPOCH: 0});
  other.local.status.earliestAvailableSlot = null;
  expect(() => startRuntime(other)).toThrow("MissingAvailability");
  const runtime = startRuntime(config);
  await runtime.close();
});

it.each([
  [false, null],
  [true, null],
  [true, 1n],
] as const)("validates startup custody with unscheduled Fulu=%s, custody=%s", async (unscheduled, custody) => {
  const config = applicationConfig();
  if (unscheduled) configureChain(config, {BLOB_SCHEDULE: [], FULU_FORK_EPOCH: Infinity});
  Reflect.set(config.local.metadata, "custodyGroupCount", custody);
  if (custody === null) {
    expect(() => startRuntime(config)).toThrow("MissingCustodyAdvertisement");
    return;
  }
  const runtime = startRuntime(config);
  try {
    expect(runtime.identity.metadata.custodyGroupCount).toBe(1n);
  } finally {
    await runtime.close();
  }
});

it.each([0, 1, 1_000_000])("starts at Gloas activation epoch %s", async (epoch) => {
  const config = applicationConfig();
  configureChain(config, {ELECTRA_FORK_EPOCH: 0, FULU_FORK_EPOCH: 0, GLOAS_FORK_EPOCH: epoch});
  setSlot(config, BigInt(epoch) * 32n);
  const runtime = startRuntime(config);
  await runtime.close();
});
