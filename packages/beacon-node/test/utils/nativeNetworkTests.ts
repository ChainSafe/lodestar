import {readFileSync, writeFileSync} from "node:fs";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ENR, SignableENR} from "@chainsafe/enr";
import {SecretKey} from "@chainsafe/lodestar-z/blst";
import {NativeApplicationConfig, NativeLocalIntent, NativePeerReportContext} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {RequestErrorCode} from "@lodestar/reqresp";
import {getProposerSlashingSignatureSets} from "@lodestar/state-transition";
import {fulu, ssz} from "@lodestar/types";
import {defer, sleep, withTimeout} from "@lodestar/utils";
import {BlsSingleThreadVerifier} from "../../src/chain/bls/singleThread.js";
import {BeaconChain} from "../../src/chain/chain.js";
import {WorkerNetworkCore} from "../../src/network/core/index.js";
import {nativeMultiaddr} from "../../src/network/core/native/addresses.js";
import {createNativeConfig} from "../../src/network/core/native/config.js";
import {NativeGossipExecutor} from "../../src/network/core/native/executor.js";
import {NativeNetworkCore} from "../../src/network/core/native/nativeNetworkCore.js";
import {NativePeers} from "../../src/network/core/native/peers.js";
import {NativePeerReports} from "../../src/network/core/native/reports.js";
import {defaultNetworkOptions} from "../../src/network/options.js";
import {PeerAction} from "../../src/network/peers/index.js";
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
  it.each(["native", "libp2p"] as const)(
    "exchanges Gloas payload envelopes with a %s peer",
    async (backend) => {
      const config = createBeaconConfig({...fuluConfig(), GLOAS_FORK_EPOCH: 0}, new Uint8Array(32));
      const left = await nativeNetworkFixture(config);
      let right: Awaited<ReturnType<typeof nativeNetworkProcess>> | undefined;
      try {
        right = await nativeNetworkProcess(config, left.chain.clock.genesisTime, backend);
        const remote = await right.network.getNetworkIdentity();
        await left.network.connectToPeer(remote.peerId, remote.p2pAddresses);
        const block = ssz.gloas.SignedBeaconBlock.defaultValue();
        block.message.proposerIndex = 1;
        const root = ssz.gloas.BeaconBlock.hashTreeRoot(block.message);
        const envelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
        envelope.message.beaconBlockRoot = root;
        const bytes = ssz.gloas.SignedExecutionPayloadEnvelope.serialize(envelope);
        await left.db.blockArchive.put(0, block);
        await right.db.blockArchive.put(0, block);
        await left.db.executionPayloadEnvelope.put(root, envelope);
        await right.db.executionPayloadEnvelope.put(root, envelope);
        const receivedRight = await left.network.sendExecutionPayloadEnvelopesByRoot(remote.peerId, [root, root]);
        const receivedLeft = await right.network.sendExecutionPayloadEnvelopesByRoot(left.network.peerId.toString(), [
          root,
          root,
        ]);
        expect(receivedRight.map((value) => ssz.gloas.SignedExecutionPayloadEnvelope.serialize(value))).toEqual([
          bytes,
        ]);
        expect(receivedLeft.map((value) => ssz.gloas.SignedExecutionPayloadEnvelope.serialize(value))).toEqual([bytes]);
        expect(
          await left.network.sendExecutionPayloadEnvelopesByRange(remote.peerId, {startSlot: 1, count: 1})
        ).toEqual([]);
        expect(
          await right.network.sendExecutionPayloadEnvelopesByRange(left.network.peerId.toString(), {
            startSlot: 1,
            count: 1,
          })
        ).toEqual([]);
        await Promise.all([left.network.subscribeGossipCoreTopics(), right.network.subscribeGossipCoreTopics()]);
        await vi.waitFor(
          async () => {
            const metrics = await left.network.scrapeMetrics();
            for (const kind of [
              "execution_payload",
              "payload_attestation_message",
              "execution_payload_bid",
              "proposer_preferences",
            ]) {
              expect(metrics).toMatch(
                new RegExp(`gossipsub_topic_peer_count\\{topicStr="/eth2/[0-9a-f]{8}/${kind}/ssz_snappy"\\} 1\\n`)
              );
            }
          },
          {timeout: 5000}
        );
      } finally {
        const results = await Promise.allSettled([right?.close(), left.close()]);
        expect(results.filter((result) => result.status === "rejected")).toEqual([]);
      }
    },
    30000
  );

  it("combines beacon and native metrics without duplicate families", async () => {
    const node = await nativeNetworkFixture(fuluConfig());
    try {
      const text = (await node.metrics.register.metrics()) + (await node.network.scrapeMetrics());
      const names = [...text.matchAll(/^# TYPE (\S+) /gm)].map((match) => match[1]);
      expect(names.length).toBe(new Set(names).size);
      for (const name of [
        "lodestar_gossip_validation_queue_length",
        "lodestar_gossip_validation_queue_concurrency",
        "lodestar_awaiting_block_gossip_messages_per_slot_total",
        "lodestar_gossip_validation_waiting_block_count",
        "lodestar_gossip_validation_queue_job_time_seconds",
        "gossipsub_topic_subscription_status",
        "gossipsub_msg_received_prevalidation_total",
        "gossipsub_pre_validation_duplicate_total",
        "gossipsub_msg_publish_count_total",
        "lodestar_gossip_peer_score_by_threshold_count",
        "lodestar_gossip_score_avg_min_max_avg",
        "beacon_reqresp_rate_limiter_errors_total",
        "lodestar_peers_report_peer_count",
      ]) {
        expect(names, name).toContain(name);
      }
      expect(text).not.toContain("lodestar_native_");
      expect(text).not.toContain("lodestar_network_processor_execute_work_calls_total");
      expect(text).not.toContain("lodestar_network_worker_");
      expect(node.metrics.networkJs).toBeNull();
    } finally {
      await node.close();
    }
  }, 15000);

  it("reports malformed SSZ using the response's captured origin", async () => {
    const node = await nativeNetworkFixture(fuluConfig());
    const context: NativePeerReportContext = {
      origin: {
        connection: {index: 2, generation: 4},
        endpoint: {family: 4, address: Uint8Array.of(192, 0, 2, 1), port: 9000},
      },
      reason: "reqresp_response",
    };
    const peer = node.network.peerId.toString();
    const request = vi.spyOn(NativeNetworkCore.prototype, "sendReqRespRequest").mockReturnValueOnce(
      (async function* () {
        yield {
          data: new Uint8Array(4000),
          fork: node.chain.config.getForkName(0),
          protocolVersion: 2,
          peerReportContext: context,
        };
      })()
    );
    const report = vi.spyOn(NativePeerReports.prototype, "report").mockImplementation(() => {});
    try {
      await expect(node.network.sendBeaconBlocksByRoot(peer, [new Uint8Array(32)])).rejects.toMatchObject({
        type: {code: RequestErrorCode.INVALID_RESPONSE_SSZ},
      });
      expect(report).toHaveBeenCalledExactlyOnceWith(peer, PeerAction.LowToleranceError, "InvalidResponseSsz", context);
    } finally {
      request.mockRestore();
      report.mockRestore();
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
      Math.floor(Date.now() / 1000),
      ssz.fulu.Status.defaultValue(),
      config.CUSTODY_REQUIREMENT,
      16
    );
    const remote = await nativeBindingProcess(application, config);
    application.identitySecretKey.fill(0);
    try {
      const peer = remote.identity;
      await remote.applyIntent(emptyIntent(application));
      // The connection's peer event reaches the throwing projection, and the binding fails the network
      void node.network
        .connectToPeer(peer.peerId, [`${nativeMultiaddr(peer.localEndpoint)}/p2p/${peer.peerId}`])
        .catch(() => {});
      await vi.waitFor(() => expect(shutdown).toHaveBeenCalledExactlyOnceWith(failure), {timeout: 5000});
      await vi.waitFor(() => expect(node.network.closed).toBe(true));
      await expect(node.network.close()).resolves.toBeUndefined();
      expect(shutdown).toHaveBeenCalledOnce();
    } finally {
      deliver.mockRestore();
      const results = await Promise.allSettled([remote.close(), node.close()]);
      expect(results[0].status).toBe("fulfilled");
      expect(results[1].status).toBe("fulfilled");
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
    const file = join(directory, "native-remembered-peers.txt");
    const [peerId, expiredPeerId] = await Promise.all(
      [0, 1].map(async () => peerIdFromPrivateKey(await generateKeyPair("secp256k1")).toString())
    );
    const nowS = Math.floor(Date.now() / 1000);
    const remembered = `${peerId} 127.0.0.1 9 ${nowS - 60}\n`;
    const older = `${peerId} 127.0.0.1 10 ${nowS - 120}\n`;
    const expired = `${expiredPeerId} 127.0.0.1 9 ${nowS - 24 * 60 * 60}\n`;
    let written: string | undefined;
    const originalInit = NativeNetworkCore.init;
    const initialize = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) => {
      const header = `lodestar-peers-v1 ${Buffer.from(modules.config.genesisValidatorsRoot).toString("hex")}\n`;
      written = `${header}${remembered}`;
      writeFileSync(file, `${header}${older}${remembered}${expired}`);
      return originalInit({...modules, peerStoreDir: directory});
    });
    let node: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
    try {
      node = await nativeNetworkFixture(fuluConfig());
      const metrics = await node.network.scrapeMetrics();
      expect(metrics).toContain('lodestar_peer_remembered_seeds_total{outcome="loaded"} 1\n');
      expect(metrics).toContain('lodestar_peer_remembered_seeds_total{outcome="expired"} 1\n');
      expect(metrics).toContain('lodestar_peer_remembered_seeds_total{outcome="duplicate"} 1\n');
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
          GLOAS_FORK_EPOCH: unsupported ? 0 : Infinity,
          HEZE_FORK_EPOCH: unsupported ? 1 : Infinity,
          BLOB_SCHEDULE: [],
        },
        new Uint8Array(32)
      );
      const originalInit = NativeNetworkCore.init;
      const init = vi.spyOn(NativeNetworkCore, "init").mockImplementationOnce((modules) => {
        if (!(modules.clock instanceof ClockStopped)) throw new Error("Expected stopped clock");
        modules.clock.setSlot(SLOTS_PER_EPOCH);
        modules.clock.genesisTime = Math.floor(Date.now() / 1000) - SLOTS_PER_EPOCH * (config.SLOT_DURATION_MS / 1000);
        return originalInit(modules);
      });
      let node: Awaited<ReturnType<typeof nativeNetworkFixture>> | undefined;
      try {
        if (unsupported) await expect(nativeNetworkFixture(config)).rejects.toThrow("UnsupportedNetworkFork");
        else {
          node = await nativeNetworkFixture(config);
          const initial = await node.network.getNetworkIdentity();
          expect(initial.metadata.attnets.uint8Array.some((byte) => byte !== 0)).toBe(true);
          await Promise.all([node.network.subscribeGossipCoreTopics(), node.network.unsubscribeGossipCoreTopics()]);
          expect(node.network.isSubscribedToGossipCoreTopics()).toBe(false);
          await node.network.subscribeGossipCoreTopics();
          expect(node.network.isSubscribedToGossipCoreTopics()).toBe(true);
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
      },
      config,
      await generateKeyPair("secp256k1"),
      Math.floor(Date.now() / 1000),
      ssz.fulu.Status.defaultValue(),
      config.CUSTODY_REQUIREMENT,
      16
    );
    application.local.status.finalizedEpoch = (1n << 64n) - 1n;
    const remote = await nativeBindingProcess(application, config);
    application.identitySecretKey.fill(0);
    try {
      const peer = await remote.identity;
      await remote.applyIntent(emptyIntent(application));
      const identity = await node.network.getNetworkIdentity();
      const peerId = peer.peerId;
      await node.network.connectToPeer(peerId, [`${nativeMultiaddr(peer.localEndpoint)}/p2p/${peerId}`]);
      await vi.waitFor(
        async () =>
          // The host refused the Status and closed the peer
          expect(await node.network.scrapeMetrics()).toContain('lodestar_peer_closes_total{reason="host"} 1\n'),
        {timeout: 5000}
      );
      await vi.waitFor(async () => expect((await remote.getPeers()).peers.length).toBe(0), {timeout: 5000});
      expect(node.network.closed).toBe(false);
      expect((await node.network.getNetworkIdentity()).peerId).toBe(identity.peerId);
    } finally {
      const results = await Promise.allSettled([remote.close(), node.close()]);
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    }
  }, 15000);
  it("keeps the native serving slot while a database read outlives peer disconnection", async () => {
    const config = fuluConfig();
    const node = await nativeNetworkFixture(config);
    let remote: Awaited<ReturnType<typeof nativeNetworkProcess>> | undefined;
    const read = defer<null>();
    const started = defer<void>();
    const serving = vi.spyOn(BeaconChain.prototype, "getSerializedBlockByRoot").mockImplementationOnce(() => {
      started.resolve();
      return read.promise;
    });
    try {
      remote = await nativeNetworkProcess(config, node.chain.clock.genesisTime);
      const identity = await node.network.getNetworkIdentity();
      const peer = await remote.network.getNetworkIdentity();
      await remote.network.connectToPeer(identity.peerId, identity.p2pAddresses);
      const request = remote.network
        .sendBeaconBlocksByRoot(identity.peerId, [new Uint8Array(32).fill(7)])
        .catch((error: unknown) => error);
      await withTimeout(() => started.promise, 5000);
      await node.network.disconnectPeer(peer.peerId);
      await vi.waitFor(
        async () => {
          expect(await node.network.scrapeMetrics()).toContain("beacon_reqresp_retiring_count 1\n");
        },
        {timeout: 5000}
      );
      expect(await request).toBeInstanceOf(Error);
      read.resolve(null);
      await vi.waitFor(async () => {
        expect(await node.network.scrapeMetrics()).toContain("beacon_reqresp_retiring_count 0\n");
      });
      expect(serving).toHaveBeenCalledOnce();
    } finally {
      read.resolve(null);
      serving.mockRestore();
      const results = await Promise.allSettled([node.close(), remote?.close()]);
      expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    }
  }, 30000);
  it("closes while real serving and gossip handlers retain unfinished host work", async () => {
    const config = fuluConfig();
    const old = await nativeNetworkFixture(config);
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
    const retired = vi.spyOn(NativeGossipExecutor.prototype, "observe");
    try {
      remote = await nativeNetworkProcess(config, old.chain.clock.genesisTime);
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
      const closing = old.network.close();
      expect(old.network.close()).toBe(closing);
      await withTimeout(() => closing, 3000);
      expect(old.network.getConnectedPeerCount()).toBe(0);
      expect(await request).toBeInstanceOf(Error);
      block.resolve(null);
      signature.resolve(false);
      await vi.waitFor(
        () => {
          expect(retired).toHaveBeenCalledOnce();
        },
        {timeout: 5000}
      );
    } finally {
      block.resolve(null);
      signature.resolve(false);
      serving.mockRestore();
      verifying.mockRestore();
      retired.mockRestore();
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
        right = await nativeNetworkProcess(config, left.chain.clock.genesisTime, backend, {}, [
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
        await vi.waitFor(async () =>
          expect(await left.network.dumpPeer(remote.peerId)).toMatchObject({peerId: remote.peerId, state: "connected"})
        );
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
        await vi.waitFor(async () => expect(await receiver.chain.opPool.hasSeenProposerSlashing(0)).toBe(true), {
          timeout: 5000,
        });
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
            expect(metrics).toMatch(/lodestar_quic_udp_sent_bytes_total [1-9]\d*\n/);
            expect(metrics).toMatch(/lodestar_quic_udp_received_bytes_total [1-9]\d*\n/);
            expect(metrics).toContain("libp2p_peers 1\n");
            expect(
              infoLogs.mock.calls.some(
                ([, context]) => (context as Record<string, unknown> | undefined)?.nativeScope === "network_runtime"
              )
            ).toBe(true);
            // The binding renders the family once
            expect(metrics.match(/^# TYPE lodestar_network_log_delivery_errors_total counter$/gm)).toHaveLength(1);
            expect(metrics).toContain("lodestar_network_log_delivery_errors_total 0\n");
            // The adapter and native registry must not duplicate metric families
            // The adapter renders its report counter once, with the report above
            expect(metrics.match(/^# TYPE lodestar_peers_report_peer_count counter$/gm)).toHaveLength(1);
            expect(metrics).toContain('lodestar_peers_report_peer_count{reason="InvalidResponseSsz"} 1\n');
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
          async () => {
            expect(left.network.getConnectedPeerCount()).toBe(0);
            const metrics = await left.network.scrapeMetrics();
            expect(metrics).toContain('gossipsub_rejected_messages_total{topic="proposer_slashing"} 1\n');
            expect(metrics).toContain('lodestar_peers_report_peer_count{reason="other"} 1\n');
          },
          {timeout: 5000}
        );
        expect(left.chain.opPool.hasSeenProposerSlashing(1)).toBe(false);
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
  it.each([12, 210])(
    "initializes a %i-peer runtime from BeaconConfig",
    async (maxPeers) => {
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
          targetPeers: maxPeers - 4,
          maxPeers,
        },
        config,
        await generateKeyPair("secp256k1"),
        Math.floor(Date.now() / 1000),
        ssz.fulu.Status.defaultValue(),
        config.CUSTODY_REQUIREMENT,
        16384
      );
      const network = createSettlingNetwork(application);
      try {
        expect((await network.getIdentity()).localEndpoint.port).toBeGreaterThan(0);
        await network.applyIntent(emptyIntent(application));
      } finally {
        await network.close();
      }
      expect(await network.closed).toEqual({reason: "requested"});
    },
    15000
  );
});

function emptyIntent(application: Omit<NativeApplicationConfig, "logLevel">): NativeLocalIntent {
  return {status: application.local.status};
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
