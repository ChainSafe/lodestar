import {generateKeyPair} from "@libp2p/crypto/keys";
import {describe, expect, it} from "vitest";
import {SignableENR} from "@chainsafe/enr";
import {createBeaconConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {UINT64_MAX, createNativeConfig} from "../../../../src/network/core/native/config.js";
import {NativeNetworkError} from "../../../../src/network/core/native/errors.js";
import {NetworkOptions, defaultNetworkOptions} from "../../../../src/network/options.js";

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
    create: (options: Partial<NetworkOptions> = {}, slot = 0) =>
      createNativeConfig(
        {...opts, ...options},
        config,
        key,
        slot,
        ssz.fulu.Status.defaultValue(),
        config.CUSTODY_REQUIREMENT,
        16
      ).application,
  };
}

describe("native configuration boundary", () => {
  it("preserves effective genesis fork selection before genesis and deduplicates same-epoch forks", async () => {
    const node = await fixture();
    const application = node.create({}, -1);
    try {
      expect(application.initialSlot).toBe(0n);
      expect(application.local.fork.fork).toBe("fulu");
      expect(application.requestForks).toEqual([
        {fork: "fulu", digest: config.forkBoundary2ForkDigest(config.getForkBoundaryAtEpoch(-1))},
      ]);
    } finally {
      application.identitySecretKey.fill(0);
    }
  });

  it.each<Partial<NetworkOptions>>([
    {tcp: true},
    {quic: false},
    {localMultiaddrs: ["/ip4/127.0.0.1/tcp/9000"]},
    {localMultiaddrs: ["/ip4/127.0.0.1/udp/9001/quic-v1", "/ip6/::1/udp/9001/quic-v1"]},
    {disablePeerScoring: true},
    {mdns: true},
    {gossipsubD: 9},
    {rateLimitMultiplier: 2},
    {dialTimeoutMs: 1000},
    {requestTimeoutMs: 1000},
    {respTimeoutMs: 1000},
    {maxPeers: 257},
    {bootMultiaddrs: ["/dns4/example.invalid/udp/9001/quic-v1"]},
  ])("rejects unmappable options: %j", async (opts) => {
    const node = await fixture();
    expect(() => node.create(opts)).toThrow(NativeNetworkError);
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
});
