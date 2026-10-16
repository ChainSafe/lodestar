import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {createBeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {UINT64_MAX, createNativeConfig} from "../../../../src/network/core/native/config.js";
import {NativeNetworkError} from "../../../../src/network/core/native/errors.js";
import {NetworkOptions, defaultNetworkOptions} from "../../../../src/network/options.js";
import {createSettlingNetwork} from "../../../utils/nativeSettlingNetwork.js";

const config = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: Infinity,
    BLOB_SCHEDULE: [],
  },
  new Uint8Array(32)
);

async function fixture() {
  const key = await generateKeyPair("secp256k1");
  const opts = {...defaultNetworkOptions, tcp: false, localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"]};
  return {
    key,
    create: (options: Partial<NetworkOptions> = {}, genesisTime = Math.floor(Date.now() / 1000), validators = 16) =>
      createNativeConfig(
        {...opts, ...options},
        config,
        key,
        genesisTime,
        ssz.fulu.Status.defaultValue(),
        config.CUSTODY_REQUIREMENT,
        validators
      ).application,
  };
}

describe("native configuration boundary", () => {
  it("passes sparse native policy and tracing options", async () => {
    const node = await fixture();
    const application = node.create();
    expect(application.traceGossip).toBeUndefined();
    expect(application.gossipPolicy).toEqual({topicConcurrency: undefined});
    expect(application.resources).toEqual({targetPeers: 200, maxPeers: 210});
    expect(node.create({native: {traceGossip: true}})).toMatchObject({
      traceGossip: true,
    });
    expect(node.create({maxGossipTopicConcurrency: 12}).gossipPolicy).toEqual({topicConcurrency: 12});
    expect(node.create({native: {receiveBudgetBytes: 1024 ** 3}}).resources.receiveBudgetBytes).toBe(1024 ** 3);
    expect(application.xray).toBeUndefined();
    expect(node.create({xrayAddress: "/tmp/xray.sock"}).xray).toEqual({
      address: "/tmp/xray.sock",
      waitForAttach: false,
    });
    expect(node.create({xrayAddress: "/tmp/xray.sock", xrayWaitForAttach: true}).xray?.waitForAttach).toBe(true);
  });

  it.each([0, 1, 1_000_000])("rejects an active unsupported fork at epoch %s before startup", async (epoch) => {
    const {key} = await fixture();
    const scheduled = createBeaconConfig({...config, GLOAS_FORK_EPOCH: epoch}, config.genesisValidatorsRoot);
    expect(() =>
      createSettlingNetwork(
        createNativeConfig(
          {...defaultNetworkOptions, tcp: false, localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"]},
          scheduled,
          key,
          Math.floor(Date.now() / 1000) - epoch * SLOTS_PER_EPOCH * (config.SLOT_DURATION_MS / 1000),
          ssz.fulu.Status.defaultValue(),
          scheduled.CUSTODY_REQUIREMENT,
          16
        ).application
      )
    ).toThrow("UnsupportedNetworkFork");
  });

  it("fits the fixed native plan at maximum gossip work capacity", async () => {
    const node = await fixture();
    const application = node.create({}, 0, 3_000_000);
    // Initialization refuses a plan past its native or bridge budget.
    const network = createSettlingNetwork(application);
    try {
      expect(await network.metrics()).toContain("gossipsub_validation_capacity_count 65535");
    } finally {
      application.identitySecretKey.fill(0);
      await network.close();
    }
  });
  it("preserves effective genesis fork selection before genesis and deduplicates same-epoch forks", async () => {
    const node = await fixture();
    const genesis = Math.floor(Date.now() / 1000) + 60;
    const application = node.create({}, genesis);
    try {
      expect(application.genesisTime).toBe(BigInt(genesis));
      expect(application.local).not.toHaveProperty("fork");
      expect(application.local.status).not.toHaveProperty("forkDigest");
      expect(application).not.toHaveProperty("requestForks");
    } finally {
      application.identitySecretKey.fill(0);
    }
  });

  it.each<Partial<NetworkOptions>>([
    {localMultiaddrs: []},
    {tcp: true},
    {quic: false},
    {localMultiaddrs: ["/ip4/127.0.0.1/tcp/9000"]},
    {localMultiaddrs: ["/ip4/127.0.0.1/udp/9001/quic-v1", "/ip4/127.0.0.2/udp/9001/quic-v1"]},
    {disablePeerScoring: true},
    {mdns: true},
    {gossipsubD: 9},
    {rateLimitMultiplier: 2},
    {dialTimeoutMs: 1000},
    {requestTimeoutMs: 1000},
    {respTimeoutMs: 1000},
    {maxPeers: 257},
    {maxPeers: 200, targetPeers: 200},
    {bootMultiaddrs: ["/dns4/example.invalid/udp/9001/quic-v1"]},
    {directPeers: ["/ip4/127.0.0.1/udp/9001/quic-v1"]},
    {directPeers: ["x".repeat(405)]},
  ])("rejects unmappable options: %j", async (opts) => {
    const node = await fixture();
    expect(() => node.create(opts)).toThrow(NativeNetworkError);
  });

  it("resolves configured direct peers into copied identities and both QUIC endpoints", async () => {
    const node = await fixture();
    const enr = SignableENR.createFromPrivateKey(node.key);
    enr.ip = "127.0.0.1";
    enr.ip6 = "::1";
    expect(() => node.create({directPeers: [enr.encodeTxt()]})).toThrow("direct peer has no QUIC address");
    enr.quic = 9001;
    enr.quic6 = 19001;
    const id = enr.peerId.toString();
    const plan = createNativeConfig(
      {
        ...defaultNetworkOptions,
        tcp: false,
        localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"],
        directPeers: [enr.encodeTxt(), `/ip4/127.0.0.2/udp/9002/quic-v1/p2p/${id}`],
      },
      config,
      node.key,
      0,
      ssz.fulu.Status.defaultValue(),
      config.CUSTODY_REQUIREMENT,
      16
    );
    try {
      enr.quic = 9003;
      expect(plan.directPeers.map((peer) => peer.peerId)).toEqual([id, id]);
      expect(plan.directPeers[0].peerId).toEqual(enr.peerId.toString());
      expect(plan.directPeers[0].addresses).toMatchObject([
        {family: 4, port: 9001},
        {family: 6, port: 19001},
      ]);
      expect(plan.directPeers[1].addresses).toEqual([{family: 4, port: 9002, address: Uint8Array.of(127, 0, 0, 2)}]);
    } finally {
      plan.application.identitySecretKey.fill(0);
    }
  });

  it("checks the imported identity and sequence before handing discovery to native", async () => {
    const node = await fixture();
    const enr = SignableENR.createFromPrivateKey(node.key);
    enr.ip = "127.0.0.1";
    enr.quic = 9001;
    enr.udp = 9000;
    enr.seq = 42n;
    const before = enr.encodeTxt();
    const discv5 = {enr: before, bindAddrs: {ip4: "/ip4/127.0.0.1/udp/0"}, bootEnrs: [], config: {}};
    const application = node.create({discv5});
    application.identitySecretKey.fill(0);
    expect(application.discovery?.sequenceNumber).toBe(43n);
    expect(enr.encodeTxt()).toBe(before);
    const stranger = SignableENR.createFromPrivateKey(await generateKeyPair("secp256k1"));
    expect(() => node.create({discv5: {...discv5, enr: stranger.encodeTxt()}})).toThrow("ENR identity or sequence");
    enr.ip = "127.0.0.2";
    enr.seq = UINT64_MAX;
    expect(() => node.create({discv5: {...discv5, enr: enr.encodeTxt()}})).toThrow("ENR identity or sequence");
  });
  it("preserves independent IPv4 and IPv6 listener and advertisement ports", async () => {
    const node = await fixture();
    const enr = SignableENR.createFromPrivateKey(node.key);
    enr.ip = "127.0.0.1";
    enr.ip6 = "::1";
    enr.udp = 9000;
    enr.quic = 9001;
    enr.udp6 = 19000;
    enr.quic6 = 19001;
    const discv5 = {
      enr: enr.encodeTxt(),
      bindAddrs: {ip4: "/ip4/0.0.0.0/udp/9000", ip6: "/ip6/::/udp/19000"},
      bootEnrs: [],
      config: {},
    };
    const localMultiaddrs = ["/ip6/::/udp/19001/quic-v1", "/ip4/0.0.0.0/udp/9001/quic-v1"];
    const application = node.create({discv5, localMultiaddrs});
    application.identitySecretKey.fill(0);
    expect(application.bind).toMatchObject([
      {family: 6, port: 19001},
      {family: 4, port: 9001},
    ]);
    expect(application.discovery?.bind).toMatchObject([
      {family: 4, port: 9000},
      {family: 6, port: 19000},
    ]);
    expect(application.discovery?.advertisement).toMatchObject({udp: 9000, udp6: 19000});
    expect(node.create({discv5, localMultiaddrs: [localMultiaddrs[1]]}).discovery?.fixed).toEqual({});
    expect(
      node.create({discv5: {...discv5, bindAddrs: {ip4: discv5.bindAddrs.ip4}}, localMultiaddrs}).discovery
        ?.advertisement?.ip6
    ).toBeUndefined();
    expect(() => node.create({discv5: {...discv5, bindAddrs: {ip4: discv5.bindAddrs.ip6}}, localMultiaddrs})).toThrow(
      "address family"
    );
  });

  it("distinguishes persisted hints from explicit startup pins and allows address-less startup", async () => {
    const node = await fixture();
    const empty = SignableENR.createFromPrivateKey(node.key);
    const cached = SignableENR.createFromPrivateKey(node.key);
    cached.ip = "198.51.100.1";
    cached.udp = 41000;
    const discv5 = {enr: empty.encodeTxt(), bindAddrs: {ip4: "/ip4/0.0.0.0/udp/0"}, bootEnrs: [], config: {}};
    const localMultiaddrs = ["/ip4/0.0.0.0/udp/0/quic-v1"];
    const bare = node.create({discv5, localMultiaddrs});
    expect(bare.discovery?.advertisement).toEqual({});
    expect(bare.discovery?.fixed).toEqual({});
    const seeded = node.create({discv5, localMultiaddrs, native: {discovery: {initialEnr: cached.encodeTxt()}}});
    expect(seeded.discovery?.advertisement).toEqual({ip4: Uint8Array.of(198, 51, 100, 1), udp: 41000});
    expect(seeded.discovery?.fixed).toEqual({});
    const pinned = node.create({discv5, native: {discovery: {fixed: {ip4: "192.0.2.1", udp: 443, quic: 444}}}});
    expect(pinned.discovery?.fixed).toEqual({ip4: Uint8Array.of(192, 0, 2, 1), udp: 443, quic: 444});
    const portOnly = node.create({discv5, native: {discovery: {fixed: {udp: 443}}}});
    expect(portOnly.discovery?.fixed).toEqual({udp: 443});
    for (const application of [bare, seeded, pinned, portOnly]) application.identitySecretKey.fill(0);
  });

  it("accepts IPv6-only QUIC and discovery", async () => {
    const node = await fixture();
    const enr = SignableENR.createFromPrivateKey(node.key);
    enr.ip6 = "::1";
    enr.udp6 = 9000;
    enr.quic6 = 9001;
    const application = node.create({
      localMultiaddrs: ["/ip6/::1/udp/0/quic-v1"],
      discv5: {enr: enr.encodeTxt(), bindAddrs: {ip6: "/ip6/::1/udp/0"}, bootEnrs: [], config: {}},
    });
    application.identitySecretKey.fill(0);
    expect(application.bind).toMatchObject([{family: 6}]);
    expect(application.discovery?.advertisement).toEqual({
      ip6: new Uint8Array(16).fill(1, 15),
      udp6: 9000,
    });
  });
});

it("passes explicit native transport overrides", async () => {
  const {create} = await fixture();
  expect(create().transport).toEqual({});
  expect(create({native: {receiveDatagramsPerTurn: 128}}).transport).toEqual({receiveDatagramsPerTurn: 128});
  expect(create({native: {initialCongestionWindowPackets: 32, receiveDatagramsPerTurn: 128}}).transport).toEqual({
    initialCongestionWindowPackets: 32,
    receiveDatagramsPerTurn: 128,
  });
});
