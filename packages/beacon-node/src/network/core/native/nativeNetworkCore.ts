import {PublishOpts} from "@libp2p/gossipsub/types";
import {ENR} from "@chainsafe/enr";
import {NativeHost, NativeNetwork, createNativeNetwork} from "@chainsafe/lodestar-z/network";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {Status} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {ClockEvent} from "../../../util/clock.js";
import {PeerAction} from "../../peers/index.js";
import {NetworkProcessorModules, NetworkProcessorOpts} from "../../processor/index.js";
import {BoundedServing} from "../../reqresp/serving/handler.js";
import {OutgoingRequestArgs} from "../../reqresp/types.js";
import {CommitteeSubscription} from "../../subnets/interface.js";
import {BaseNetworkInit} from "../networkCore.js";
import {INetworkCore} from "../types.js";
import {NativePeerAddress, nativeMultiaddr, parseNativeEndpoint, parseNativePeerAddress} from "./addresses.js";
import {createNativeConfig} from "./config.js";
import {dumpNativeGossipScores, dumpNativeMeshPeers, dumpNativePeerScores} from "./diagnostics.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";
import {NativeGossipExecutor} from "./executor.js";
import {NativeGossip} from "./gossip.js";
import {NativeIntent} from "./intent.js";
import {NativeLogs} from "./logs.js";
import {NativePeers, formatNativePeer} from "./peers.js";
import {RememberedPeersWriter, readRememberedPeers} from "./rememberedPeers.js";
import {NativePeerReports} from "./reports.js";
import {NativeRequests, outgoingNativeRequest} from "./requests.js";

/** The binding renders its metric families, and the adapter adds its serving reservation gauges and report counter. */
type NativeNetworkInit = Omit<BaseNetworkInit, "metricsRegistry" | "getReqRespHandler"> & {serving: BoundedServing};

export class NativeNetworkCore implements INetworkCore {
  private intent!: NativeIntent;
  private gossip!: NativeGossip;
  private peers!: NativePeers;
  private requests!: NativeRequests;
  private reports!: NativePeerReports;
  private network!: NativeNetwork;
  private logs!: NativeLogs;
  private remembered: RememberedPeersWriter | undefined;
  private closed = false;
  private failure: Error | undefined;
  private closePromise: Promise<void> | undefined;
  private constructor(private readonly modules: NativeNetworkInit) {}

  static init(modules: NativeNetworkInit): NativeNetworkCore {
    const {opts, config, privateKey, clock, initialStatus, initialCustodyGroupCount, activeValidatorCount} = modules;
    const {peerStoreDir, logger} = modules;
    const {
      application,
      network: networkConfig,
      directPeers,
      bootPeers,
    } = createNativeConfig(
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
      },
    });
    try {
      const rememberedPeers = peerStoreDir
        ? readRememberedPeers(peerStoreDir, config.genesisValidatorsRoot, logger)
        : null;
      core.logs = new NativeLogs(modules.logger.child({module: "native"}));
      // The factory calls the host only from later macrotasks, so every consumer below attaches first.
      core.network = createNativeNetwork({...application, rememberedPeers, logLevel: core.logs.level}, core.host);
      core.intent = new NativeIntent(
        core.network,
        application,
        networkConfig,
        clock,
        core.modules.opts,
        initialStatus,
        core.onFailure
      );
      core.gossip = new NativeGossip(core.network, config, modules.events, core.modules.opts, core.onOperationError);
      core.peers = new NativePeers(core.network, config, modules.events, core.network.limits.peerCapacity);
      core.requests = new NativeRequests(config, modules.serving, core.network.limits.incomingCapacity, logger);
      core.reports = new NativePeerReports(core.network);
      void core.network.closed
        .then((result) => {
          if (result.reason === "failed" && !core.failure)
            modules.logger.error("Native network failed", {}, result.error);
          return core.close();
        })
        .catch((error: unknown) => modules.logger.error("Native network terminal cleanup failed", {}, error as Error));
      modules.clock.on(ClockEvent.slot, core.onSlot);
      core.intent.refresh();
      queueMicrotask(() => {
        if (!core.closed) void core.connectConfiguredPeers(directPeers, bootPeers).catch(core.onFailure);
      });
      if (peerStoreDir) core.remembered = new RememberedPeersWriter(peerStoreDir, core.network, logger);
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
    return new NativeGossipExecutor(modules, opts, this.gossip);
  }

  private async connectConfiguredPeers(
    directPeers: NativePeerAddress[],
    bootPeers: NativePeerAddress[]
  ): Promise<void> {
    for (const peer of directPeers) {
      if (this.closed) return;
      try {
        await this.network.setDirectPeer(peer.peerId, peer.addresses);
      } catch (error) {
        if (
          this.closed &&
          error instanceof Error &&
          "code" in error &&
          (error.code === "NetworkClosed" || error.code === "Stopped")
        )
          return;
        throw error;
      }
    }
    for (const peer of bootPeers) {
      if (this.closed) return;
      try {
        await this.network.connect(peer.peerId, peer.addresses);
      } catch (error) {
        this.modules.logger.debug("Native bootstrap dial failed", {peer: peer.peerId}, error as Error);
      }
    }
  }

  /** Reports the host's first failure, the native failure, or null after a clean shutdown. */
  get terminated(): Promise<Error | null> {
    return this.network.closed.then((result) => this.failure ?? (result.reason === "failed" ? result.error : null));
  }

  private readonly onSlot = (): void => {
    try {
      this.intent.refresh();
    } catch (error) {
      this.onFailure(error);
    }
  };
  /** Delivered work goes to the adapter's consumers; once it closes, the binding only settles. */
  private readonly host: NativeHost = {
    capacity: () => ({
      gossipValidation: this.gossip.ready() ? "ready" : "backpressured",
      incomingRequestSlots: this.requests.capacity(),
    }),
    subscribeCapacity: (wake) => {
      const unsubscribeGossip = this.gossip.subscribeCapacity(wake);
      let unsubscribeRequests: () => void;
      try {
        unsubscribeRequests = this.requests.subscribeCapacity(wake);
      } catch (error) {
        unsubscribeGossip();
        throw error;
      }
      return () => {
        unsubscribeGossip();
        unsubscribeRequests();
      };
    },
    validate: (job) => this.gossip.validate(job),
    checkDependencies: (checks) => this.gossip.checkDependencies(checks),
    serve: (request) => this.requests.serve(request),
    peers: (events) => this.peers.deliver(events),
    failed: (error) => this.onFailure(error),
    logs: (records, lost) => this.logs.deliver(records, lost),
    error: (error) => this.onOperationError(error),
  };
  private readonly onFailure = (error: unknown): void => {
    if (this.failure) return;
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

  /** Releases resources. Operational failure is reported by terminated. */
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const completion = defer<void>();
    this.closePromise = completion.promise;
    this.closed = true;
    void (async () => {
      const errors: unknown[] = [];
      for (const cleanup of [
        () => this.network?.stopDelivery(),
        () => this.modules.clock.off(ClockEvent.slot, this.onSlot),
        () => this.gossip?.close(),
        () => this.requests?.close(),
        () => this.peers?.close(),
        () => this.intent?.close(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      // The network refuses the final remembered peers snapshot once it closes.
      try {
        await this.remembered?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await this.network?.close();
      } catch (error) {
        errors.push(error);
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Native network cleanup failed");
    })().then(() => completion.resolve(), completion.reject);
    return this.closePromise;
  }
  prepareBeaconCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.intent.committee(subscriptions, false);
  }
  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): Promise<void> {
    return this.intent.committee(subscriptions, true);
  }
  isSubscribedToGossipCoreTopics(): boolean {
    return this.intent.isSubscribedToCoreTopics();
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
  reportPeer(peer: string, action: PeerAction, actionName: string): void {
    this.reports.report(peer, action, actionName);
  }
  reStatusPeers(peers: string[]): Promise<void> {
    nativeInteger(peers.length, "re-status peers", this.modules.opts.maxPeers);
    return this.network.reStatus(peers);
  }
  async getConnectedPeers(): Promise<string[]> {
    return (await this.network.getPeers()).peers
      .filter((peer) => peer.connection !== null)
      .map((peer) => peer.identity);
  }
  async getConnectedPeerCount(): Promise<number> {
    return (await this.network.getPeers()).counts.connected;
  }
  connectToPeer(peer: string, addresses: string[]): Promise<void> {
    nativeInteger(addresses.length, "dial addresses", 2, 1);
    return this.network.connect(
      peer,
      addresses.map((address) => parseNativeEndpoint(address, true, peer))
    );
  }
  disconnectPeer(peer: string): Promise<void> {
    return this.network.disconnect(peer);
  }
  async addDirectPeer(peer: routes.lodestar.DirectPeer): Promise<string | null> {
    const direct = parseNativePeerAddress(peer);
    await this.network.setDirectPeer(direct.peerId, direct.addresses);
    return direct.peerId;
  }
  removeDirectPeer(peer: string): Promise<boolean> {
    return this.network.setDirectPeer(peer, null);
  }
  async getDirectPeers(): Promise<string[]> {
    return (await this.network.getDirectPeers()).identities;
  }
  sendReqRespRequest(data: OutgoingRequestArgs) {
    return outgoingNativeRequest(this.network, data, (action, reason) => {
      if (this.closed) return;
      try {
        this.reports.report(data.peerId, action, reason);
      } catch (error) {
        this.modules.logger.debug("Native request peer report failed", {peer: data.peerId, reason}, error as Error);
      }
    });
  }
  publishGossip(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<number> {
    return this.gossip.publish(topic, data, opts);
  }
  async getNetworkIdentity(): Promise<routes.node.NetworkIdentity> {
    const identity = await this.network.getIdentity();
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
    return this.network.metrics() + this.requests.metrics() + this.reports.metrics();
  }
  private unavailable(resource: string): Promise<never> {
    return Promise.reject(new NativeNetworkError({code: NativeNetworkErrorCode.UNAVAILABLE, resource}));
  }
  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    const snapshot = await this.network.getPeers();
    return snapshot.peers.filter((peer) => peer.connection !== null).map(formatNativePeer);
  }
  async dumpPeer(peerId: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const snapshot = await this.network.getPeers();
    const peer = snapshot.peers.find((peer) => peer.connection !== null && peer.identity === peerId);
    return peer ? formatNativePeer(peer) : undefined;
  }
  dumpPeerScoreStats(): ReturnType<typeof dumpNativePeerScores> {
    return dumpNativePeerScores(this.network);
  }
  dumpGossipPeerScoreStats(): ReturnType<typeof dumpNativeGossipScores> {
    return dumpNativeGossipScores(this.network);
  }
  dumpDiscv5KadValues(): Promise<never> {
    return this.unavailable("discovery routing-table snapshot");
  }
  dumpMeshPeers(): ReturnType<typeof dumpNativeMeshPeers> {
    return dumpNativeMeshPeers(this.network);
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
