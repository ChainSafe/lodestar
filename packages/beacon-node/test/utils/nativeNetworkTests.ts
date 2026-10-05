import {readFileSync, writeFileSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ENR, SignableENR} from "@chainsafe/enr";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {NativeApplicationConfig, NativeLocalIntent} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {getProposerSlashingSignatureSets} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {defer, sleep, toHex, withTimeout} from "@lodestar/utils";
import {BlsSingleThreadVerifier} from "../../src/chain/bls/singleThread.js";
import {BeaconChain} from "../../src/chain/chain.js";
import {WorkerNetworkCore} from "../../src/network/core/index.js";
import {nativeMultiaddr} from "../../src/network/core/native/addresses.js";
import {createNativeConfig} from "../../src/network/core/native/config.js";
import {NativeIntent} from "../../src/network/core/native/intent.js";
import {NativeNetworkCore} from "../../src/network/core/native/nativeNetworkCore.js";
import {NativePeers} from "../../src/network/core/native/peers.js";
import {NetworkEvent, NetworkEventData} from "../../src/network/events.js";
import {defaultNetworkOptions} from "../../src/network/options.js";
import {PeerAction} from "../../src/network/peers/index.js";
import {ClockEvent} from "../../src/util/clock.js";
import {ClockStopped} from "../mocks/clock.js";
import {nativeBindingProcess} from "./nativeBindingProcess.js";
import {nativeNetworkFixture} from "./nativeNetwork.js";
import {nativeNetworkProcess} from "./nativeNetworkProcess.js";
import {createSettlingNetwork} from "./nativeSettlingNetwork.js";

/** Clears retained mock calls and collects the previous test's runtime before the next one initializes. */
async function nativeRuntimeReleased(): Promise<void> {
  vi.clearAllMocks();
  for (let i = 0; i < 200; i++) {
    global.gc?.();
    await sleep(5);
    try {
      createSettlingNetwork({} as NativeApplicationConfig);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("NetworkAlreadyInitialized")) return;
    }
  }
  throw Error("A native network runtime is still live");
}

describe("native Lodestar integration", () => {
  beforeEach(nativeRuntimeReleased);
  it("requests node shutdown once with the original host failure", async () => {
    const shutdown = vi.fn();
    const node = await nativeNetworkFixture(fuluConfig(), "native", {}, undefined, shutdown);
    const failure = new Error("test slot update failed");
    const refresh = vi.spyOn(NativeIntent.prototype, "refresh").mockImplementation(() => {
      throw failure;
    });
    try {
      node.chain.clock.emit(ClockEvent.slot, 1);
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledExactlyOnceWith(failure));
      await vi.waitFor(() => expect(node.network.closed).toBe(true));
      node.chain.clock.emit(ClockEvent.slot, 2);
      await node.network.close();
      expect(shutdown).toHaveBeenCalledOnce();
    } finally {
      refresh.mockRestore();
      await node.close();
    }
  }, 15000);

  it("requests node shutdown once with a delivery failure the binding reported", async () => {
    const config = fuluConfig();
    const shutdown = vi.fn();
    const node = await nativeNetworkFixture(config, "native", {}, undefined, shutdown);
    const failure = new Error("test peer projection failed");
    const deliver = vi.spyOn(NativePeers.prototype, "deliver").mockImplementation(() => {
      throw failure;
    });
    const {application} = createNativeConfig(
      {
        ...defaultNetworkOptions,
        tcp: false,
        localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"],
        maxPeers: 12,
        targetPeers: 8,
      },
      config,
      await generateKeyPair("secp256k1"),
      0,
      ssz.fulu.Status.defaultValue(),
      config.CUSTODY_REQUIREMENT,
      16
    );
    const remote = await nativeBindingProcess(application, config);
    application.identitySecretKey.fill(0);
    try {
      const peer = remote.identity;
      await remote.applyIntent(emptyIntent(application), 0n);
      // The connection's peer event reaches the throwing projection, and the binding fails the network
      void node.network
        .connectToPeer(peer.peerId, [`${nativeMultiaddr(peer.localEndpoint)}/p2p/${peer.peerId}`])
        .catch(() => {});
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledExactlyOnceWith(failure), {timeout: 5000});
      await vi.waitFor(() => expect(node.network.closed).toBe(true));
      await node.network.close();
      expect(shutdown).toHaveBeenCalledOnce();
    } finally {
      deliver.mockRestore();
      const results = await Promise.allSettled([remote.close(), node.close()]);
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    }
  }, 15000);

  it("ordinary network shutdown delivers the native records of its close and does not request process failure", async () => {
    const shutdown = vi.fn();
    const node = await nativeNetworkFixture(fuluConfig(), "native", {}, undefined, shutdown);
    const infoLogs = vi.spyOn(Object.getPrototypeOf(testLogger()), "info");
    try {
      await node.network.close();
      expect(
        infoLogs.mock.calls.some(
          ([message, context]) =>
            String(message).startsWith("owner_stopped reason=requested") &&
            (context as Record<string, unknown> | undefined)?.nativeScope === "network_runtime"
        )
      ).toBe(true);
      expect(shutdown).not.toHaveBeenCalled();
    } finally {
      infoLogs.mockRestore();
      await node.close();
    }
  }, 15000);
  it("seeds the runtime from peerStoreDir and writes its remembered peers before it closes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lodestar-native-peerstore-"));
    const file = join(directory, "native-remembered-peers.json");
    const [peerId, expiredPeerId] = await Promise.all(
      [0, 1].map(async () => peerIdFromPrivateKey(await generateKeyPair("secp256k1")).toString())
    );
    const nowS = Math.floor(Date.now() / 1000);
    const remembered = {peerId, endpoint: {family: 4, address: "0x7f000001", port: 9}, qualifiedAtUnixS: nowS - 60};
    const older = {...remembered, endpoint: {...remembered.endpoint, port: 10}, qualifiedAtUnixS: nowS - 120};
    const expired = {...remembered, peerId: expiredPeerId, qualifiedAtUnixS: nowS - 24 * 60 * 60};
    let written: string | undefined;
    const originalInit = NativeNetworkCore.init;
    const initialize = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) => {
      const seed = {
        version: 1,
        genesisValidatorsRoot: toHex(modules.config.genesisValidatorsRoot),
        peers: [remembered],
      };
      written = JSON.stringify(seed);
      writeFileSync(file, JSON.stringify({...seed, peers: [older, remembered, expired]}, null, 2));
      return originalInit({...modules, peerStoreDir: directory});
    });
    let node: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
    try {
      node = await nativeNetworkFixture(fuluConfig());
      const metrics = await node.network.scrapeMetrics();
      expect(metrics).toContain('lodestar_native_remembered_peer_seeds_total{outcome="loaded"} 1\n');
      expect(metrics).toContain('lodestar_native_remembered_peer_seeds_total{outcome="expired"} 1\n');
      expect(metrics).toContain('lodestar_native_remembered_peer_seeds_total{outcome="duplicate"} 1\n');
      await node.network.close();
      expect(readFileSync(file, "utf8")).toBe(written);
    } finally {
      await node?.close();
      initialize.mockRestore();
      await rm(directory, {recursive: true, force: true});
    }
  }, 15000);
  it("rejects malformed configured direct peers before native initialization", async () => {
    const originalInit = NativeNetworkCore.init;
    const initialize = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) =>
      originalInit({
        ...modules,
        opts: {...modules.opts, directPeers: ["/ip4/127.0.0.1/udp/9001/quic-v1"]},
      })
    );
    let node: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
    try {
      await expect(nativeNetworkFixture(fuluConfig())).rejects.toThrow("direct peer identity");
      node = await nativeNetworkFixture(fuluConfig());
      expect(node.network.closed).toBe(false);
    } finally {
      await node?.close();
      initialize.mockRestore();
    }
  }, 15000);
  it.each([false, true])(
    "initializes current fork state or fails before starting: unsupported=%s",
    async (unsupported) => {
      const config = createBeaconConfig(
        {
          ALTAIR_FORK_EPOCH: 0,
          BELLATRIX_FORK_EPOCH: 0,
          CAPELLA_FORK_EPOCH: 0,
          DENEB_FORK_EPOCH: 0,
          ELECTRA_FORK_EPOCH: 0,
          FULU_FORK_EPOCH: unsupported ? 0 : 1,
          GLOAS_FORK_EPOCH: unsupported ? 1 : Infinity,
          BLOB_SCHEDULE: [],
        },
        new Uint8Array(32)
      );
      const originalInit = NativeNetworkCore.init;
      const init = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) => {
        if (!(modules.clock instanceof ClockStopped)) throw new Error("Expected stopped clock");
        modules.clock.setSlot(SLOTS_PER_EPOCH);
        return originalInit(modules);
      });
      let node: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
      try {
        if (unsupported) await expect(nativeNetworkFixture(config)).rejects.toThrow("Unsupported native fork gloas");
        else {
          node = await nativeNetworkFixture(config);
          const initial = await node.network.getNetworkIdentity();
          expect(initial.metadata.attnets.uint8Array.some((byte) => byte !== 0)).toBe(true);
          await node.network.subscribeGossipCoreTopics();
          expect(node.network.closed).toBe(false);
          expect((await node.network.getNetworkIdentity()).metadata.custodyGroupCount).toBeGreaterThan(0);
        }
        expect(init).toHaveBeenCalledOnce();
      } finally {
        await node?.close();
        init.mockRestore();
      }
    },
    15000
  );
  it("returns current signed discovery and metadata snapshots after a native intent", async () => {
    const originalInit = NativeNetworkCore.init;
    let imported: string | undefined;
    const initialize = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) => {
      const enr = SignableENR.createFromPrivateKey(modules.privateKey);
      enr.ip = "127.0.0.1";
      enr.udp = 9000;
      enr.quic = 9001;
      enr.seq = 42n;
      imported = enr.encodeTxt();
      return originalInit({
        ...modules,
        opts: {
          ...modules.opts,
          discv5: {
            enr: imported,
            bindAddrs: {ip4: "/ip4/127.0.0.1/udp/0"},
            bootEnrs: [],
            config: {},
          },
        },
      });
    });
    let node: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
    try {
      node = await nativeNetworkFixture(fuluConfig());
      const before = await node.network.getNetworkIdentity();
      expect(ENR.decodeTxt(before.enr).seq).toBeGreaterThan(42n);
      expect(before.enr).not.toBe(imported);
      await node.network.prepareSyncCommitteeSubnets([{validatorIndex: 0, subnet: 1, slot: 0, isAggregator: true}]);
      const after = await node.network.getNetworkIdentity();
      const enr = ENR.decodeTxt(after.enr);
      expect(enr.peerId.toString()).toBe(after.peerId);
      expect(enr.seq).toBeGreaterThan(ENR.decodeTxt(before.enr).seq);
      expect(enr.kvs.get("syncnets")).toEqual(after.metadata.syncnets.uint8Array);
      expect(after.metadata.seqNumber).toBeGreaterThan(before.metadata.seqNumber);
      expect(before.metadata.syncnets.uint8Array).toEqual(Uint8Array.of(0));
      expect(after.metadata.syncnets.uint8Array).toEqual(Uint8Array.of(2));
    } finally {
      await node?.close();
      initialize.mockRestore();
    }
  }, 15000);
  it("disconnects an actual peer with uint64 Status values outside the host range without stopping the network", async () => {
    const config = fuluConfig();
    const node = await nativeNetworkFixture(config);
    const {application} = createNativeConfig(
      {
        ...defaultNetworkOptions,
        tcp: false,
        localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"],
        maxPeers: 12,
        targetPeers: 8,
        native: {profile: "small"},
      },
      config,
      await generateKeyPair("secp256k1"),
      0,
      ssz.fulu.Status.defaultValue(),
      config.CUSTODY_REQUIREMENT,
      16
    );
    application.local.status.finalizedEpoch = (1n << 64n) - 1n;
    const remote = await nativeBindingProcess(application, config);
    application.identitySecretKey.fill(0);
    try {
      const peer = await remote.identity;
      await remote.applyIntent(emptyIntent(application), 0n);
      const identity = await node.network.getNetworkIdentity();
      const peerId = peer.peerId;
      await node.network.connectToPeer(peerId, [`${nativeMultiaddr(peer.localEndpoint)}/p2p/${peerId}`]);
      await vi.waitFor(
        async () =>
          // The host refused the Status and closed the peer
          expect(await node.network.scrapeMetrics()).toContain('lodestar_native_peer_closes_total{reason="host"} 1\n'),
        {timeout: 5000}
      );
      await vi.waitFor(async () => expect((await remote.getPeers()).counts.connected).toBe(0), {timeout: 5000});
      expect(node.network.closed).toBe(false);
      expect((await node.network.getNetworkIdentity()).peerId).toBe(identity.peerId);
    } finally {
      const results = await Promise.allSettled([remote.close(), node.close()]);
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    }
  }, 15000);
  it("closes while real serving and gossip handlers retain unfinished host work", async () => {
    const config = fuluConfig();
    // The weighted plan gives proposer slashings one execution slot with this budget.
    const limits = {hostGossipItems: 65, hostGossipBytes: 64 * 1024 * 1024};
    const old = await nativeNetworkFixture(config, "native", limits);
    let remote: Awaited<ReturnType<typeof nativeNetworkProcess>> | undefined;
    const block = defer<null>();
    const signature = defer<boolean>();
    // Vitest keeps every spy's target, so spy on prototypes that outlive this fixture.
    const serving = vi
      .spyOn(BeaconChain.prototype, "getSerializedBlockByRoot")
      .mockImplementationOnce(() => block.promise);
    const verifying = vi
      .spyOn(BlsSingleThreadVerifier.prototype, "verifySignatureSets")
      .mockImplementationOnce(() => signature.promise);
    try {
      remote = await nativeNetworkProcess(config, "native", limits);
      const identity = await old.network.getNetworkIdentity();
      await Promise.all([old.network.subscribeGossipCoreTopics(), remote.network.subscribeGossipCoreTopics()]);
      await remote.network.connectToPeer(identity.peerId, identity.p2pAddresses);
      const request = remote.network
        .sendBeaconBlocksByRoot(identity.peerId, [new Uint8Array(32).fill(7)])
        .catch((error: unknown) => error);
      await vi.waitFor(() => expect(serving).toHaveBeenCalledOnce(), {timeout: 5000});
      const slashing = ssz.phase0.ProposerSlashing.defaultValue();
      slashing.signedHeader1.message.bodyRoot.fill(1);
      slashing.signedHeader2.message.bodyRoot.fill(2);
      const publisher = remote.network;
      await vi.waitFor(async () => expect(await publisher.publishProposerSlashing(slashing)).toBeGreaterThan(0), {
        timeout: 5000,
      });
      await vi.waitFor(() => expect(verifying).toHaveBeenCalledOnce(), {timeout: 5000});
      expect(old.budget.snapshot().occupancy).toBe(1);
      const closing = old.network.close();
      expect(old.network.close()).toBe(closing);
      await withTimeout(() => closing, 3000);
      expect(old.network.getConnectedPeerCount()).toBe(0);
      expect(old.budget.snapshot()).toMatchObject({occupancy: 1, outstandingRetirements: 1});
      expect(await request).toBeInstanceOf(Error);
      const retired = vi.fn();
      old.network.events.on(NetworkEvent.gossipMessageValidationResult, retired);
      block.resolve(null);
      signature.resolve(false);
      await vi.waitFor(
        () => {
          expect(retired).toHaveBeenCalledOnce();
          expect(old.budget.snapshot().occupancy).toBe(0);
        },
        {timeout: 5000}
      );
    } finally {
      block.resolve(null);
      signature.resolve(false);
      serving.mockRestore();
      verifying.mockRestore();
      const results = await Promise.allSettled([old.close(), remote?.close()]);
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    }
  }, 30000);
  it.each([
    {backend: "native", family: 4},
    {backend: "native", family: 6},
    {backend: "libp2p", family: 4},
    {backend: "libp2p", family: 6},
  ] as const)(
    "serves blocks and gossip with an IPv$family $backend peer from a dual-stack runtime",
    async ({backend, family}) => {
      const worker = vi.spyOn(WorkerNetworkCore, "init");
      // Native log records at the logger's level reach it with their native context
      const infoLogs = vi.spyOn(Object.getPrototypeOf(testLogger()), "info");
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
      const left = await nativeNetworkFixture(config, "native", {}, [
        "/ip4/127.0.0.1/udp/0/quic-v1",
        "/ip6/::1/udp/0/quic-v1",
      ]);
      let right: Awaited<ReturnType<typeof nativeNetworkProcess>> | undefined;
      try {
        right = await nativeNetworkProcess(config, backend, {}, [
          family === 4 ? "/ip4/127.0.0.1/udp/0/quic-v1" : "/ip6/::1/udp/0/quic-v1",
        ]);
        expect((await left.network.getNetworkIdentity()).p2pAddresses).toHaveLength(2);
        const remote = await right.network.getNetworkIdentity();
        expect(() =>
          left.network.connectToPeer(
            remote.peerId,
            Array.from({length: 3}, () => remote.p2pAddresses[0])
          )
        ).toThrow("dial addresses");
        await left.network.connectToPeer(remote.peerId, remote.p2pAddresses);
        expect(await left.network.dumpPeer(remote.peerId)).toMatchObject({peerId: remote.peerId, state: "connected"});
        expect(await left.network.dumpPeers()).toMatchObject([{peerId: remote.peerId, state: "connected"}]);
        expect(await left.network.dumpPeer(left.network.peerId.toString())).toBeUndefined();
        const leftBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
        leftBlock.message.proposerIndex = 1;
        const rightBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
        rightBlock.message.proposerIndex = 2;
        await left.db.blockArchive.put(0, leftBlock);
        await right.db.blockArchive.put(0, rightBlock);
        const receivedRight = await left.network.sendBeaconBlocksByRoot(remote.peerId, [
          ssz.fulu.BeaconBlock.hashTreeRoot(rightBlock.message),
        ]);
        expect(
          receivedRight.map((block) => ssz.fulu.SignedBeaconBlock.serialize(block as fulu.SignedBeaconBlock))
        ).toEqual([ssz.fulu.SignedBeaconBlock.serialize(rightBlock)]);
        const receivedLeft = await right.network.sendBeaconBlocksByRoot(left.network.peerId.toString(), [
          ssz.fulu.BeaconBlock.hashTreeRoot(leftBlock.message),
        ]);
        expect(
          receivedLeft.map((block) => ssz.fulu.SignedBeaconBlock.serialize(block as fulu.SignedBeaconBlock))
        ).toEqual([ssz.fulu.SignedBeaconBlock.serialize(leftBlock)]);
        await Promise.all([left.network.subscribeGossipCoreTopics(), right.network.subscribeGossipCoreTopics()]);
        const rejected: NetworkEventData[NetworkEvent.gossipMessageValidationResult][] = [];
        left.network.events.on(NetworkEvent.gossipMessageValidationResult, (result) => rejected.push(result));
        const slashing = ssz.phase0.ProposerSlashing.defaultValue();
        slashing.signedHeader1.message.bodyRoot.fill(1);
        slashing.signedHeader2.message.bodyRoot.fill(2);
        const sets = getProposerSlashingSignatureSets(left.chain.config, 0, slashing);
        const secret = SecretKey.fromBytes(Buffer.alloc(32, 1));
        slashing.signedHeader1.signature = secret.sign(sets[0].signingRoot).toBytes();
        slashing.signedHeader2.signature = secret.sign(sets[1].signingRoot).toBytes();
        await vi.waitFor(async () => expect(await left.network.publishProposerSlashing(slashing)).toBeGreaterThan(0), {
          timeout: 5000,
          interval: 100,
        });
        const receiver = right;
        await vi.waitFor(
          async () =>
            expect((await receiver.validationResults()).map((result) => result.acceptance)).toContain(
              TopicValidatorResult.Accept
            ),
          {timeout: 5000}
        );
        expect(await right.chain.opPool.hasSeenProposerSlashing(0)).toBe(true);
        const scores = await left.network.dumpPeerScoreStats();
        expect(scores).toMatchObject([{peerId: remote.peerId, ignoreNegativeGossipScore: false}]);
        expect(Number.isFinite(scores[0].gossipScore)).toBe(true);
        const gossipScores = await left.network.dumpGossipPeerScoreStats();
        expect(gossipScores[remote.peerId]).toMatchObject({connected: true});
        const meshPeers = await left.network.dumpMeshPeers();
        expect(Object.keys(meshPeers).length).toBeGreaterThan(0);
        await left.network.reportPeer(remote.peerId, PeerAction.HighToleranceError, "InvalidResponseSsz");

        await vi.waitFor(
          async () => {
            const metrics = await left.network.scrapeMetrics();
            expect(metrics).toContain("libp2p_peers 1\n");
            expect(metrics).toContain('beacon_reqresp_outgoing_requests_total{method="beacon_blocks_by_root"} 1\n');
            expect(metrics).toContain('beacon_reqresp_incoming_requests_total{method="beacon_blocks_by_root"} 1\n');
            expect(metrics).toContain(
              'beacon_reqresp_outgoing_request_roundtrip_time_seconds_count{method="beacon_blocks_by_root"} 1\n'
            );
            expect(metrics).toContain(
              'beacon_reqresp_incoming_request_handler_time_seconds_count{method="beacon_blocks_by_root"} 1\n'
            );
            // Gossipsub tracks the remote peer, whose score the dumps above read, on the topic it scored
            expect(metrics).toMatch(
              /gossipsub_topic_peer_count\{topicStr="\/eth2\/[0-9a-f]{8}\/proposer_slashing\/ssz_snappy"\} 1\n/
            );
            expect(metrics).toMatch(/lodestar_native_quic_udp_sent_bytes_total [1-9]\d*\n/);
            expect(metrics).toMatch(/lodestar_native_quic_udp_received_bytes_total [1-9]\d*\n/);
            expect(metrics).toContain("libp2p_peers 1\n");
            expect(
              infoLogs.mock.calls.some(
                ([, context]) => (context as Record<string, unknown> | undefined)?.nativeScope === "network_runtime"
              )
            ).toBe(true);
            // The binding renders the family once
            expect(metrics.match(/^# TYPE lodestar_native_log_delivery_errors_total counter$/gm)).toHaveLength(1);
            expect(metrics).toContain("lodestar_native_log_delivery_errors_total 0\n");
            // The adapter renders its serving gauges once, and the served request returned its charges
            expect(metrics.match(/^# TYPE lodestar_native_host_serving_reserved_bytes gauge$/gm)).toHaveLength(1);
            expect(metrics.match(/^# TYPE lodestar_native_host_serving_source_pending_bytes gauge$/gm)).toHaveLength(1);
            expect(metrics).toContain('lodestar_native_host_serving_reserved_bytes{scope="total"} 0\n');
            expect(metrics).toContain("lodestar_native_host_serving_source_pending_bytes 0\n");
            // The adapter renders its report counter once, with the report above
            expect(metrics.match(/^# TYPE lodestar_native_peer_reports_total counter$/gm)).toHaveLength(1);
            expect(metrics).toContain(
              'lodestar_native_peer_reports_total{reason="InvalidResponseSsz",action="high_tolerance"} 1\n'
            );
          },
          {timeout: 5000}
        );
        const invalid = ssz.phase0.ProposerSlashing.defaultValue();
        invalid.signedHeader1.message.proposerIndex = 1;
        invalid.signedHeader2.message.proposerIndex = 1;
        invalid.signedHeader1.message.bodyRoot.fill(1);
        invalid.signedHeader2.message.bodyRoot.fill(2);
        expect(await right.network.publishProposerSlashing(invalid)).toBeGreaterThan(0);
        await vi.waitFor(
          () => expect(rejected.map((result) => result.acceptance)).toContain(TopicValidatorResult.Reject),
          {timeout: 5000}
        );
        expect(left.chain.opPool.hasSeenProposerSlashing(1)).toBe(false);
        await vi.waitFor(
          async () => {
            expect(left.network.getConnectedPeerCount()).toBe(0);
            const metrics = await left.network.scrapeMetrics();
            expect(metrics).toContain('gossipsub_rejected_messages_total{topic="proposer_slashing"} 1\n');
            expect(metrics).toContain('lodestar_native_peer_reports_total{reason="other",action="fatal"} 1\n');
          },
          {timeout: 5000}
        );
        expect(worker).not.toHaveBeenCalled();
      } finally {
        const results = await Promise.allSettled([left.close(), right?.close()]);
        worker.mockRestore();
        infoLogs.mockRestore();
        expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      }
    },
    30000
  );
  it.each(["small", "beaconNode"] as const)(
    "initializes the %s runtime from BeaconConfig",
    async (profile) => {
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
      const {application} = createNativeConfig(
        {
          ...defaultNetworkOptions,
          backend: "native",
          tcp: false,
          localMultiaddrs: ["/ip4/127.0.0.1/udp/0/quic-v1"],
          targetPeers: profile === "small" ? 8 : 200,
          maxPeers: profile === "small" ? 12 : 210,
          native: {profile},
        },
        config,
        await generateKeyPair("secp256k1"),
        0,
        ssz.fulu.Status.defaultValue(),
        config.CUSTODY_REQUIREMENT,
        16384
      );
      const network = createSettlingNetwork(application);
      try {
        expect((await network.getIdentity()).localEndpoint.port).toBeGreaterThan(0);
        await network.applyIntent(emptyIntent(application), 0n);
      } finally {
        await network.close();
      }
      expect(await network.closed).toEqual({reason: "requested"});
    },
    15000
  );
});

function emptyIntent(application: Omit<NativeApplicationConfig, "logLevel">): NativeLocalIntent {
  return {
    update: {
      local: application.local,
    },
    subscriptions: [],
    demand: {
      attnets: new Uint8Array(8),
      syncnets: 0,
      groupTargets: new Uint16Array(128),
      custodyGroupTargets: new Uint16Array(128),
      attestationTarget: 6,
      syncTarget: 6,
    },
  };
}

function fuluConfig() {
  return createBeaconConfig(
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
}
