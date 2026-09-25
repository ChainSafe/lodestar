import {PublishOpts} from "@libp2p/gossipsub/types";
import {ENR} from "@chainsafe/enr";
import {
  NativeNetworkApplicationRuntime,
  NativePeerAction,
  initializeNativeNetworkRuntime,
} from "@chainsafe/lodestar-z/network";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {Status} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {ClockEvent} from "../../../util/clock.js";
import {PeerAction} from "../../peers/index.js";
import {NetworkProcessorModules, NetworkProcessorOpts} from "../../processor/index.js";
import {assertBoundedReqRespHandlers} from "../../reqresp/serving/handler.js";
import {OutgoingRequestArgs} from "../../reqresp/types.js";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {BaseNetworkInit} from "../networkCore.js";
import {INetworkCore} from "../types.js";
import {NativeDirectPeer, nativeMultiaddr, parseNativeDirectPeer, parseNativeEndpoint} from "./addresses.js";
import {createNativeConfig} from "./config.js";
import {dumpNativeGossipScores, dumpNativeMeshPeers, dumpNativePeerScores} from "./diagnostics.js";
import {NativeDrain, NativeDrainLimits, NativeDrainStages} from "./drain.js";
import {NativeNetworkError, NativeNetworkErrorCode, isNativeResultAllocationError, nativeInteger} from "./errors.js";
import {NativeGossipExecutor} from "./executor.js";
import {NativeGossip} from "./gossip.js";
import {NativeIntent} from "./intent.js";
import {NativeLogs} from "./logs.js";
import {NativePeers, formatNativePeer} from "./peers.js";
import {nativeProtocols} from "./protocols.js";
import {NativeRequests, outgoingNativeRequest} from "./requests.js";

const actions: Record<PeerAction, NativePeerAction> = {
  [PeerAction.Fatal]: "fatal",
  [PeerAction.LowToleranceError]: "low_tolerance",
  [PeerAction.MidToleranceError]: "mid_tolerance",
  [PeerAction.HighToleranceError]: "high_tolerance",
};

/** Bounds of one native drain macrotask; the rest yields to the next one. */
const drainLimits: NativeDrainLimits = {
  budgetMs: 8,
  peers: 32,
  settle: 32,
  servingStarts: 8,
  gossipItems: 64,
  gossipBytes: 8 * 1024 * 1024,
};

export class NativeNetworkCore implements INetworkCore {
  private intent!: NativeIntent;
  private gossip!: NativeGossip;
  private peers!: NativePeers;
  private requests!: NativeRequests;
  private runtime!: NativeNetworkApplicationRuntime;
  private logs: NativeLogs | undefined;
  private drain!: NativeDrain;
  private closed = false;
  private failure: Error | undefined;
  private closePromise: Promise<void> | undefined;
  private constructor(private readonly modules: BaseNetworkInit) {}

  static init(modules: BaseNetworkInit): NativeNetworkCore {
    if (modules.peerStoreDir)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "native peer-store persistence",
      });
    assertBoundedReqRespHandlers(modules.getReqRespHandler);
    const {opts, config, privateKey, clock, initialStatus, initialCustodyGroupCount, activeValidatorCount} = modules;
    const {application, network, directPeers} = createNativeConfig(
      opts,
      config,
      privateKey,
      clock.currentSlot,
      initialStatus,
      initialCustodyGroupCount,
      activeValidatorCount
    );
    const core = new NativeNetworkCore({
      ...modules,
      opts: {
        ...opts,
        native: opts.native && {...opts.native},
        directPeers: opts.directPeers?.slice(),
        bootMultiaddrs: opts.bootMultiaddrs?.slice(),
      },
    });
    try {
      core.runtime = initializeNativeNetworkRuntime(application, core.onWorkAvailable);
      core.drain = new NativeDrain(
        core.runtime,
        drainLimits,
        core.drainStages,
        core.onDrainError,
        modules.metricsRegistry
      );
      core.intent = new NativeIntent(
        core.runtime,
        application,
        network,
        clock,
        core.modules.opts,
        initialStatus,
        core.onFailure
      );
      core.logs = new NativeLogs(core.runtime, modules.logger.child({module: "native"}));
      const diagnostics = core.runtime.diagnostics();
      core.gossip = new NativeGossip(
        core.runtime,
        config,
        modules.events,
        core.modules.opts,
        core.onOperationError,
        core.onFailure,
        modules.metricsRegistry
      );
      core.peers = new NativePeers(core.runtime, config, modules.events, diagnostics.resolvedCapacities.peerCapacity);
      core.requests = new NativeRequests(
        config,
        modules.getReqRespHandler,
        diagnostics.incoming.capacity,
        core.onWorkAvailable
      );
      void core.runtime.closed
        .then((result) => {
          if (result.reason === "failed")
            modules.logger.error("Native network owner failed", {code: core.runtime.diagnostics().terminalErrorCode});
          return core.close();
        })
        .catch((error: unknown) => modules.logger.error("Native network terminal cleanup failed", {}, error as Error));
      modules.clock.on(ClockEvent.slot, core.onSlot);
      core.intent.refresh();
      queueMicrotask(() => {
        if (!core.closed) void core.connectConfiguredPeers(directPeers).catch(core.onFailure);
      });
      return core;
    } catch (error) {
      void core
        .close()
        .catch((closeError: unknown) => modules.logger.error("Native startup cleanup failed", {}, closeError as Error));
      throw error;
    } finally {
      application.identitySecretKey.fill(0);
    }
  }

  createGossipExecutor(modules: NetworkProcessorModules, opts: NetworkProcessorOpts): NativeGossipExecutor {
    return new NativeGossipExecutor(modules, opts, this.gossip, this.onWorkAvailable);
  }

  private async connectConfiguredPeers(directPeers: NativeDirectPeer[]): Promise<void> {
    const {opts} = this.modules;
    for (const peer of directPeers) {
      if (this.closed) return;
      await this.runtime.addDirectPeer(peer.identity, peer.addresses);
    }
    await this.connectBootnodes(opts.bootMultiaddrs ?? []);
  }

  private async connectBootnodes(addresses: string[]): Promise<void> {
    for (const address of addresses) {
      if (this.closed) return;
      const peer = address.split("/p2p/")[1];
      try {
        await this.connectToPeer(peer, [address]);
      } catch (error) {
        this.modules.logger.debug("Native bootstrap dial failed", {peer}, error as Error);
      }
    }
  }

  get terminated(): Promise<Error | null> {
    return this.runtime.closed.then((result) => {
      if (this.failure) return this.failure;
      if (result.reason !== "failed") return null;
      let resource = "native owner";
      try {
        resource = this.runtime.diagnostics().terminalErrorCode ?? resource;
      } catch {}
      return new NativeNetworkError({code: NativeNetworkErrorCode.FAILED, resource});
    });
  }

  private readonly onSlot = (): void => {
    try {
      this.intent.refresh();
    } catch (error) {
      this.onFailure(error);
    }
  };
  /** Only schedules; native results settle in the drain, which also runs after close until native has none left. */
  private readonly onWorkAvailable = (): void => {
    this.drain.request();
  };
  private readonly stages: NativeDrainStages = {
    serving: (max) => this.requests.demand(max),
    gossip: (limits) => this.gossip.demand(limits),
    deliver: (result, gossip, deadline) => {
      this.peers.deliver(result.peers);
      this.requests.start(result.serving, result.servingQueued);
      return this.gossip.deliver(result.checks, result.gossip, gossip, deadline);
    },
  };
  private readonly drainStages = (): NativeDrainStages | null => (this.closed ? null : this.stages);
  private readonly onDrainError = (error: unknown): boolean => {
    if (!isNativeResultAllocationError(error)) {
      this.onFailure(error);
      return false;
    }
    this.onOperationError(error);
    return true;
  };
  private readonly onFailure = (error: unknown): void => {
    if (this.closed) return;
    this.failure =
      error instanceof Error ? error : new NativeNetworkError({code: NativeNetworkErrorCode.FAILED, resource: "host"});
    if (!(error instanceof Error)) this.failure.cause = error;
    this.onOperationError(this.failure);
    void this.close().catch((error: unknown) =>
      this.modules.logger.error("Native network close failed", {}, error as Error)
    );
  };

  private readonly onOperationError = (error: unknown): void => {
    try {
      this.modules.logger.error("Native network operation failed", {}, error as Error);
    } catch {}
  };

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const completion = defer<void>();
    this.closePromise = completion.promise;
    this.closed = true;
    this.modules.clock.off(ClockEvent.slot, this.onSlot);
    this.gossip?.close();
    this.requests?.close();
    this.peers?.close();
    this.intent?.close();
    try {
      if (this.runtime)
        void this.runtime
          .close()
          .finally(() => this.logs?.close())
          .then(() => completion.resolve(), completion.reject);
      else completion.resolve();
    } catch (error) {
      this.logs?.close();
      completion.reject(error);
    }
    return this.closePromise;
  }
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.intent.committee(subscriptions, false);
  }
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.intent.committee(subscriptions, true);
  }
  subscribeGossipCoreTopics(): Promise<void> {
    return this.intent.coreTopics(true);
  }
  unsubscribeGossipCoreTopics(): Promise<void> {
    return this.intent.coreTopics(false);
  }
  updateStatus(status: Status): Promise<void> {
    return this.intent.updateStatus(status);
  }
  setTargetGroupCount(count: number): Promise<void> {
    return this.intent.custody(count);
  }
  reportPeer(peer: string, action: PeerAction, _actionName: string): void {
    this.runtime.reportPeer(peer, actions[action]);
  }
  reStatusPeers(peers: string[]): Promise<void> {
    nativeInteger(peers.length, "re-status peers", this.modules.opts.maxPeers);
    return this.runtime.reStatusPeers(peers);
  }
  async getConnectedPeers(): Promise<string[]> {
    return (await this.runtime.getPeers()).peers
      .filter((peer) => peer.connection !== null)
      .map((peer) => peer.identity);
  }
  async getConnectedPeerCount(): Promise<number> {
    return (await this.runtime.getPeers()).counts.connected;
  }
  connectToPeer(peer: string, addresses: string[]): Promise<void> {
    nativeInteger(addresses.length, "dial addresses", 2, 1);
    return this.runtime.connect(
      peer,
      addresses.map((address) => parseNativeEndpoint(address, true, peer)),
      BigInt(this.modules.opts.dialTimeoutMs ?? 10000)
    );
  }
  disconnectPeer(peer: string): Promise<void> {
    return this.runtime.disconnect(peer);
  }
  async addDirectPeer(peer: routes.lodestar.DirectPeer): Promise<string | null> {
    const direct = parseNativeDirectPeer(peer);
    await this.runtime.addDirectPeer(direct.identity, direct.addresses);
    return direct.id;
  }
  removeDirectPeer(peer: string): Promise<boolean> {
    return this.runtime.removeDirectPeer(peer);
  }
  async getDirectPeers(): Promise<string[]> {
    return (await this.runtime.getDirectPeers()).identities;
  }
  sendReqRespRequest(data: OutgoingRequestArgs) {
    const {opts, config, clock} = this.modules;
    return outgoingNativeRequest(this.runtime, nativeProtocols(config, config.getForkName(clock.currentSlot)), data, {
      negotiationTimeoutMs: opts.dialTimeoutMs,
      requestTimeoutMs: opts.requestTimeoutMs,
      responseTimeoutMs: opts.respTimeoutMs,
    });
  }
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<number> {
    return this.gossip.publish(topic, data, opts);
  }
  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    const identity = await this.runtime.getIdentity();
    const peerId = identity.peerId;
    const enr = identity.localEnr ? ENR.decode(identity.localEnr) : undefined;
    const metadata = identity.metadata;
    const discoveryAddresses = [enr?.getLocationMultiaddr("udp4"), enr?.getLocationMultiaddr("udp6")]
      .filter((address) => address !== undefined)
      .map((address) => `${address}/p2p/${peerId}`);
    const p2pAddresses = new Set(
      identity.localEndpoints.map((endpoint) => `${nativeMultiaddr(endpoint)}/p2p/${peerId}`)
    );
    for (const protocol of ["quic4", "quic6"] as const) {
      const address = enr?.getLocationMultiaddr(protocol);
      if (address) p2pAddresses.add(`${address}/p2p/${peerId}`);
    }
    return {
      peerId,
      enr: enr?.encodeTxt() ?? "",
      discoveryAddresses,
      p2pAddresses: Array.from(p2pAddresses),
      metadata: {
        seqNumber: metadata.sequenceNumber,
        attnets: new BitArray(Uint8Array.from(metadata.attnets), 64),
        syncnets: new BitArray(Uint8Array.of(metadata.syncnets), 4),
        ...(metadata.custodyGroupCount === null ? {} : {custodyGroupCount: Number(metadata.custodyGroupCount)}),
      },
    };
  }
  async scrapeMetrics(): Promise<string> {
    const counters = {
      log_delivery_errors_total: this.logs?.deliveryErrors ?? 0,
      peer_status_range_refusals_total: this.peers.statusRefusals,
    };
    return [
      this.runtime.getMetrics(),
      ...Object.entries(counters).map(
        ([name, value]) => `# TYPE lodestar_native_${name} counter\nlodestar_native_${name} ${value}\n`
      ),
      (await this.modules.metricsRegistry?.metrics()) ?? "",
    ].join("");
  }
  private unavailable(resource: string): Promise<never> {
    return Promise.reject(new NativeNetworkError({code: NativeNetworkErrorCode.UNAVAILABLE, resource}));
  }
  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    const snapshot = await this.runtime.getPeers();
    return snapshot.peers.filter((peer) => peer.connection !== null).map(formatNativePeer);
  }
  async dumpPeer(peerId: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const snapshot = await this.runtime.getPeers();
    const peer = snapshot.peers.find((peer) => peer.connection !== null && peer.identity === peerId);
    return peer ? formatNativePeer(peer) : undefined;
  }
  dumpPeerScoreStats(): ReturnType<typeof dumpNativePeerScores> {
    return dumpNativePeerScores(this.runtime);
  }
  dumpGossipPeerScoreStats(): ReturnType<typeof dumpNativeGossipScores> {
    return dumpNativeGossipScores(this.runtime);
  }
  dumpDiscv5KadValues(): Promise<never> {
    return this.unavailable("discovery routing-table snapshot");
  }
  dumpMeshPeers(): ReturnType<typeof dumpNativeMeshPeers> {
    return dumpNativeMeshPeers(this.runtime);
  }
  writeNetworkThreadProfile(_durationMs: number, _dirpath: string): Promise<never> {
    return this.unavailable("native thread CPU profile");
  }
  writeDiscv5Profile(_durationMs: number, _dirpath: string): Promise<never> {
    return this.unavailable("native discovery CPU profile");
  }
  writeNetworkHeapSnapshot(_prefix: string, _dirpath: string): Promise<never> {
    return this.unavailable("native heap snapshot");
  }
  writeDiscv5HeapSnapshot(_prefix: string, _dirpath: string): Promise<never> {
    return this.unavailable("native discovery heap snapshot");
  }
}
