import {generateKeyPair, privateKeyFromRaw} from "@libp2p/crypto/keys";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {createBeaconConfig} from "@lodestar/config";
import {genesisData, networksChainConfig} from "@lodestar/config/networks";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {UINT64_MAX, createNativeConfig, kinds, nativeTopicScore} from "../../../../src/network/core/native/config.js";
import {NativeNetworkError} from "../../../../src/network/core/native/errors.js";
import {computeGossipPeerScoreParams} from "../../../../src/network/gossip/scoringParameters.js";
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
    create: (options: Partial<NetworkOptions> = {}, slot = 0, validators = 16) =>
      createNativeConfig(
        {...opts, ...options},
        config,
        key,
        slot,
        ssz.fulu.Status.defaultValue(),
        config.CUSTODY_REQUIREMENT,
        validators
      ).application,
  };
}

describe("native configuration boundary", () => {
  it("builds the active send startup policy", async () => {
    const node = await fixture();
    expect(node.create().gossipPolicy).toMatchObject({
      activeSendTimeoutMs: 6000n,
      activeSendItems: {beacon_block: 8, blob_sidecar: 32, data_column_sidecar: 256},
    });
    const application = node.create({
      native: {gossipActiveSendTimeoutMs: 4000, gossipActiveSendItems: {beacon_block: 4}},
    });
    expect(application.gossipPolicy).toMatchObject({activeSendTimeoutMs: 4000n, activeSendItems: {beacon_block: 4}});
    for (const timeout of [0, -1, 1.5, 86400001]) {
      expect(() => node.create({native: {gossipActiveSendTimeoutMs: timeout}})).toThrow(NativeNetworkError);
    }
  });

  it.each([0, 1, 1_000_000, Number.MAX_SAFE_INTEGER])(
    "rejects unsupported forks scheduled at epoch %s before startup",
    async (epoch) => {
      const {key} = await fixture();
      const scheduled = createBeaconConfig({...config, GLOAS_FORK_EPOCH: epoch}, config.genesisValidatorsRoot);
      expect(() =>
        createNativeConfig(
          {...defaultNetworkOptions, tcp: false},
          scheduled,
          key,
          0,
          ssz.fulu.Status.defaultValue(),
          scheduled.CUSTODY_REQUIREMENT,
          16
        )
      ).toThrow("Unsupported native fork gloas");
    }
  );

  it("fits the fixed native plan at maximum gossip work capacity", async () => {
    const node = await fixture();
    const application = node.create({}, 0, 3_000_000);
    // Initialization refuses a plan past its native or bridge budget.
    const network = createSettlingNetwork(application);
    try {
      const capacity = Object.values(application.gossipPolicy.processor).reduce(
        (items, limit) => items + limit.items,
        0
      );
      expect(capacity).toBe(65535);
    } finally {
      application.identitySecretKey.fill(0);
      await network.close();
    }
  });
  it.each([1_700_000, 1_800_000, 3_000_000])("bounds gossip work capacity for %i validators", async (validators) => {
    const node = await fixture();
    const application = node.create({}, 0, validators);
    try {
      const {processor} = application.gossipPolicy;
      const otherItems = kinds.reduce(
        (sum, kind) => sum + (kind === "beacon_attestation" ? 0 : processor[kind].items),
        0
      );
      expect(processor.beacon_attestation.items).toBe(
        Math.min(Math.ceil((validators / SLOTS_PER_EPOCH) * 1.1), 65535 - otherItems)
      );
      expect(otherItems + processor.beacon_attestation.items).toBeLessThanOrEqual(65535);
    } finally {
      application.identitySecretKey.fill(0);
    }
  });

  it("preserves effective genesis fork selection before genesis and deduplicates same-epoch forks", async () => {
    const node = await fixture();
    const application = node.create({}, -1);
    try {
      expect(application.initialSlot).toBe(0n);
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
    {maxGossipTopicConcurrency: Number.NaN},
    {native: {hostGossipBytes: 1024}},
    {maxPeers: 257},
    {maxPeers: 200, targetPeers: 200},
    {bootMultiaddrs: ["/dns4/example.invalid/udp/9001/quic-v1"]},
    {directPeers: ["/ip4/127.0.0.1/udp/9001/quic-v1"]},
    {directPeers: ["x".repeat(405)]},
  ])("rejects unmappable options: %j", async (opts) => {
    const node = await fixture();
    expect(() => node.create(opts)).toThrow(NativeNetworkError);
  });

  it("resolves dial concurrency independently of peer headroom", async () => {
    const node = await fixture();
    for (const [maxPeers, targetPeers] of [
      [210, 200],
      [201, 200],
      [256, 255],
    ]) {
      const application = node.create({maxPeers, targetPeers});
      try {
        expect(application.resources.dialingCapacity).toBe(32);
      } finally {
        application.identitySecretKey.fill(0);
      }
    }
    const small = node.create({native: {profile: "small"}});
    try {
      expect(small.resources.dialingCapacity).toBe(4);
    } finally {
      small.identitySecretKey.fill(0);
    }
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

it.each([16, 1_000_000])(
  "startup kind policies preserve upstream scoring across activation slots for %i validators",
  async (validators) => {
    const node = await fixture();
    const application = node.create({}, 0, validators);
    application.identitySecretKey.fill(0);
    const policies = application.gossipPolicy.score.topics;
    const boundary = config.forkBoundariesAscendingEpochOrder.findLast((boundary) => boundary.epoch === 0);
    if (!boundary) throw Error("Missing genesis boundary");
    const digest = Buffer.from(config.forkBoundary2ForkDigest(boundary)).toString("hex");
    expect(Object.keys(policies).sort()).toEqual([...kinds].sort());
    expect(policies.sync_committee.weight).toBe(0);
    expect(policies.data_column_sidecar.weight).toBe(0);
    for (const kind of ["beacon_block", "beacon_aggregate_and_proof", "beacon_attestation"] as const) {
      const policy = policies[kind];
      expect(policy.meshDeliveryStartSlot).toBeGreaterThan(0n);
      for (const offset of [-1, 0, 1]) {
        const slot = Number(policy.meshDeliveryStartSlot) + offset;
        const upstream = computeGossipPeerScoreParams({
          config,
          eth2Context: {
            activeValidatorCount: validators,
            currentSlot: slot,
            currentEpoch: Math.floor(slot / SLOTS_PER_EPOCH),
          },
        });
        const topic = `/eth2/${digest}/${kind}${kind === "beacon_attestation" ? "_0" : ""}/ssz_snappy`;
        const params = upstream.topics?.[topic];
        if (!params) throw Error(`Missing upstream parameters: ${topic}`);
        const effective = {...policy};
        if (offset < 0) {
          effective.meshDeliveryWeight = 0;
          effective.meshDeliveryThreshold = 0;
        }
        expect(effective).toEqual(nativeTopicScore(params, Number(policy.meshDeliveryStartSlot)));
      }
    }
  }
);

describe("native gossip limits", () => {
  const key = privateKeyFromRaw(new Uint8Array(32).fill(7));

  it.each(["mainnet", "hoodi"] as const)("resolves the %s gossip limits", (network) => {
    const beaconConfig = createBeaconConfig(
      networksChainConfig[network],
      fromHex(genesisData[network].genesisValidatorsRoot)
    );
    const resolved = [16, 1_000_000].map((validators) => {
      const {application} = createNativeConfig(
        {...defaultNetworkOptions, tcp: false, localMultiaddrs: ["/ip4/127.0.0.1/udp/9000/quic-v1"]},
        beaconConfig,
        key,
        0,
        ssz.fulu.Status.defaultValue(),
        beaconConfig.CUSTODY_REQUIREMENT,
        validators
      );
      const {processor, execution} = application.gossipPolicy;
      return {
        validators,
        limits: Object.fromEntries(
          kinds.map((kind) => [kind, {processor: processor[kind], execution: execution?.[kind]}])
        ),
      };
    });
    expect(resolved).toMatchSnapshot();
  });
});
