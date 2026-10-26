import {PublishOpts} from "@libp2p/gossipsub/types";
import {ENR} from "@chainsafe/enr";
import {NativeHost, NativeNetwork, NativePeerReportContext, createNativeNetwork} from "@chainsafe/lodestar-z/network";
import {BitArray} from "@chainsafe/ssz";
import {routes} from "@lodestar/api";
import {Status} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {NetworkEvent} from "../../events.js";
import {PeerAction} from "../../peers/index.js";
import {NetworkProcessorModules, NetworkProcessorOpts} from "../../processor/index.js";
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
import {NativePeerReports} from "./reports.js";
import {outgoingNativeRequest, serveNativeRequest} from "./requests.js";

type NativeNetworkInit = Omit<BaseNetworkInit, "metricsRegistry">;

export class NativeNetworkCore implements INetworkCore {
  private intent!: NativeIntent;
  private gossip!: NativeGossip;
  private peers!: NativePeers;
  private reports!: NativePeerReports;
  private network!: NativeNetwork;
  private logs!: NativeLogs;
  private closed = false;
  private failure: Error | undefined;
  private closePromise: Promise<void> | undefined;
  private constructor(private readonly modules: NativeNetworkInit) {}

  static async init(modules: NativeNetworkInit): Promise<NativeNetworkCore> {
    const {opts, config, privateKey, clock, initialStatus, initialCustodyGroupCount, activeValidatorCount} = modules;
    const {peerStoreDir} = modules;
    const {application, directPeers, bootPeers} = createNativeConfig(
      opts,
      config,
      privateKey,
      clock.genesisTime,
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
      core.logs = new NativeLogs(modules.logger.child({module: "native"}));
      // The factory calls the host only from later macrotasks, so every consumer below attaches first.
      core.network = createNativeNetwork(
        {...application, ...(peerStoreDir ? {peerStoreDir} : {}), logLevel: core.logs.level},
        core.host
      );
      core.intent = new NativeIntent(core.network);
      core.reports = new NativePeerReports(core.network);
      core.gossip = new NativeGossip(core.network, config, core.modules.opts, core.onOperationError, core.reports);
      core.peers = new NativePeers(core.network, config, modules.events, core.network.limits.peerCapacity);
      void core.network.closed
        .then((result) => {
          if (result.reason === "failed" && !core.failure)
            modules.logger.error("Native network failed", {}, result.error);
          return core.close();
        })
        .catch((error: unknown) => modules.logger.error("Native network terminal cleanup failed", {}, error as Error));
      queueMicrotask(() => {
        if (!core.closed) void core.connectConfiguredPeers(directPeers, bootPeers).catch(core.onFailure);
      });
      return core;
    } catch (error) {
      await core
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

  /** Delivered work goes to the adapter's consumers; once it closes, the binding only settles. */
  private readonly host: NativeHost = {
    requestCapacityChanged: () => this.modules.events.emit(NetworkEvent.requestCapacityChanged, null),
    capacity: () => ({
      gossipValidation: this.gossip.ready() ? "ready" : "backpressured",
      incomingRequestSlots: this.network.limits.incomingCapacity,
    }),
    subscribeCapacity: (wake) => this.gossip.subscribeCapacity(wake),
    validate: (job) => this.gossip.validate(job),
    checkDependencies: (checks) => this.gossip.checkDependencies(checks),
    serve: (request) =>
      serveNativeRequest(request, this.modules.getReqRespHandler, this.modules.config, this.modules.logger),
    peers: (events) => this.peers.deliver(events),
    failed: (error) => this.onFailure(error),
    logs: (records) => this.logs.deliver(records),
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
        () => this.gossip?.close(),
        () => this.peers?.close(),
        () => this.intent?.close(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
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
  reportPeer(peer: string, action: PeerAction, actionName: string, context?: NativePeerReportContext): void {
    this.reports.report(peer, action, actionName, context);
  }
  reStatusPeers(peers: string[]): Promise<void> {
    nativeInteger(peers.length, "re-status peers", this.modules.opts.maxPeers);
    return this.network.reStatus(peers);
  }
  async getConnectedPeers(): Promise<string[]> {
    return this.peers.connected();
  }
  async getConnectedPeerCount(): Promise<number> {
    return this.peers.connectedCount;
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
    return this.network.getDirectPeers();
  }
  async watchRequestCapacity(token: string): Promise<boolean> {
    return this.network.watchRequestCapacity(token);
  }
  sendReqRespRequest(data: OutgoingRequestArgs) {
    return outgoingNativeRequest(this.network, data, (action, reason, origin) => {
      if (this.closed) return;
      try {
        this.reports.report(data.peerId, action, reason, origin ? {origin, reason: "reqresp_response"} : undefined);
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
    try {
      return (await this.network.metrics()) + this.reports.metrics();
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "NetworkClosed") return "";
      throw error;
    }
  }
  private unavailable(resource: string): Promise<never> {
    return Promise.reject(new NativeNetworkError({code: NativeNetworkErrorCode.UNAVAILABLE, resource}));
  }
  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.peers.states().map(formatNativePeer);
  }
  async dumpPeer(peerId: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const peer = this.peers.state(peerId);
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
