import LibP2p, {Connection} from "libp2p";
import PeerId from "peer-id";
import {IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../chain";
import {GoodByeReasonCode, GOODBYE_KNOWN_CODES, Libp2pEvent} from "../../constants";
import {IMetrics} from "../../metrics";
import {NetworkEvent, INetworkEventBus} from "../events";
import {IReqResp, ReqRespMethod, RequestTypedContainer} from "../reqresp";
import {prettyPrintPeerId, getClientFromPeerStore} from "../util";
import {ISubnetsService} from "../subnets";
import {Libp2pPeerMetadataStore} from "./metastore";
import {PeerDiscovery, SubnetDiscvQueryMs} from "./discover";
import {IPeerRpcScoreStore, ScoreState} from "./score";
import {
  getConnectedPeerIds,
  hasSomeConnectedPeer,
  assertPeerRelevance,
  prioritizePeers,
  renderIrrelevantPeerType,
} from "./utils";
import {SubnetType} from "../metadata";

/** heartbeat performs regular updates such as updating reputations and performing discovery requests */
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
/** The time in seconds between PING events. We do not send a ping if the other peer has PING'd us */
const PING_INTERVAL_INBOUND_MS = 4 * 60 * 1000 - 11 * 1000; // Offset to not ping when outbound reqs
const PING_INTERVAL_OUTBOUND_MS = 4 * 60 * 1000;
/** The time in seconds between re-status's peers. */
const STATUS_INTERVAL_MS = 5 * 60 * 1000;
/** Expect a STATUS request from on inbound peer for some time. Afterwards the node does a request */
const STATUS_INBOUND_GRACE_PERIOD = 15 * 1000;
/** Internal interval to check PING and STATUS timeouts */
const CHECK_PING_STATUS_INTERVAL = 10 * 1000;

// TODO:
// maxPeers and targetPeers should be dynamic on the num of validators connected
// The Node should compute a recomended value every interval and log a warning
// to terminal if it deviates significantly from the user's settings

export type PeerManagerOpts = {
  /** The target number of peers we would like to connect to. */
  targetPeers: number;
  /** The maximum number of peers we allow (exceptions for subnet peers) */
  maxPeers: number;
  /**
   * Delay the 1st query after starting discv5
   * See https://github.com/ChainSafe/lodestar/issues/3423
   */
  discv5FirstQueryDelayMs: number;
  /**
   * If null, Don't run discv5 queries, nor connect to cached peers in the peerStore
   */
  discv5: IDiscv5DiscoveryInputOptions | null;
  /**
   * If set to true, connect to Discv5 bootnodes. If not set or false, do not connect
   */
  connectToDiscv5Bootnodes?: boolean;
};

export type PeerManagerModules = {
  libp2p: LibP2p;
  logger: ILogger;
  metrics: IMetrics | null;
  reqResp: IReqResp;
  attnetsService: ISubnetsService;
  syncnetsService: ISubnetsService;
  chain: IBeaconChain;
  config: IBeaconConfig;
  peerMetadata: Libp2pPeerMetadataStore;
  peerRpcScores: IPeerRpcScoreStore;
  networkEventBus: INetworkEventBus;
};

type PeerIdStr = string;

enum RelevantPeerStatus {
  Unknown = "unknown",
  relevant = "relevant",
  irrelevant = "irrelevant",
}

type PeerData = {
  lastReceivedMsgUnixTsMs: number;
  lastStatusUnixTsMs: number;
  connectedUnixTsMs: number;
  relevantStatus: RelevantPeerStatus;
  direction: Connection["stat"]["direction"];
  peerId: PeerId;
};

/**
 * Performs all peer managment functionality in a single grouped class:
 * - Ping peers every `PING_INTERVAL_MS`
 * - Status peers every `STATUS_INTERVAL_MS`
 * - Execute discovery query if under target peers
 * - Execute discovery query if need peers on some subnet: TODO
 * - Disconnect peers if over target peers
 */
export class PeerManager {
  private libp2p: LibP2p;
  private logger: ILogger;
  private metrics: IMetrics | null;
  private reqResp: IReqResp;
  private attnetsService: ISubnetsService;
  private syncnetsService: ISubnetsService;
  private chain: IBeaconChain;
  private config: IBeaconConfig;
  private peerMetadata: Libp2pPeerMetadataStore;
  private peerRpcScores: IPeerRpcScoreStore;
  /** If null, discovery is disabled */
  private discovery: PeerDiscovery | null;
  private networkEventBus: INetworkEventBus;

  // A single map of connected peers with all necessary data to handle PINGs, STATUS, and metrics
  private connectedPeers = new Map<PeerIdStr, PeerData>();

  private opts: PeerManagerOpts;
  private intervals: NodeJS.Timeout[] = [];

  constructor(modules: PeerManagerModules, opts: PeerManagerOpts) {
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.reqResp = modules.reqResp;
    this.attnetsService = modules.attnetsService;
    this.syncnetsService = modules.syncnetsService;
    this.chain = modules.chain;
    this.config = modules.config;
    this.peerMetadata = modules.peerMetadata;
    this.peerRpcScores = modules.peerRpcScores;
    this.networkEventBus = modules.networkEventBus;
    this.opts = opts;

    // opts.discv5 === null, discovery is disabled
    this.discovery =
      opts.discv5 &&
      new PeerDiscovery(modules, {
        maxPeers: opts.maxPeers,
        discv5FirstQueryDelayMs: opts.discv5FirstQueryDelayMs,
        discv5: opts.discv5,
        connectToDiscv5Bootnodes: opts.connectToDiscv5Bootnodes,
      });

    const {metrics} = modules;
    if (metrics) {
      metrics.peers.addCollect(() => this.runPeerCountMetrics(metrics));
    }
  }

  async start(): Promise<void> {
    await this.discovery?.start();
    this.libp2p.connectionManager.on(Libp2pEvent.peerConnect, this.onLibp2pPeerConnect);
    this.libp2p.connectionManager.on(Libp2pEvent.peerDisconnect, this.onLibp2pPeerDisconnect);
    this.networkEventBus.on(NetworkEvent.reqRespRequest, this.onRequest);

    // On start-up will connected to existing peers in libp2p.peerStore, same as autoDial behaviour
    this.heartbeat();
    this.intervals = [
      setInterval(this.pingAndStatusTimeouts.bind(this), CHECK_PING_STATUS_INTERVAL),
      setInterval(this.heartbeat.bind(this), HEARTBEAT_INTERVAL_MS),
    ];
  }

  async stop(): Promise<void> {
    await this.discovery?.stop();
    this.libp2p.connectionManager.removeListener(Libp2pEvent.peerConnect, this.onLibp2pPeerConnect);
    this.libp2p.connectionManager.removeListener(Libp2pEvent.peerDisconnect, this.onLibp2pPeerDisconnect);
    this.networkEventBus.off(NetworkEvent.reqRespRequest, this.onRequest);
    for (const interval of this.intervals) clearInterval(interval);
  }

  /**
   * Return peers with at least one connection in status "open"
   */
  getConnectedPeerIds(): PeerId[] {
    return getConnectedPeerIds(this.libp2p);
  }

  /**
   * Efficiently check if there is at least one peer connected
   */
  hasSomeConnectedPeer(): boolean {
    return hasSomeConnectedPeer(this.libp2p);
  }

  async goodbyeAndDisconnectAllPeers(): Promise<void> {
    await Promise.all(
      // Filter by peers that support the goodbye protocol: {supportsProtocols: [goodbyeProtocol]}
      this.getConnectedPeerIds().map(async (peer) => this.goodbyeAndDisconnect(peer, GoodByeReasonCode.CLIENT_SHUTDOWN))
    );
  }

  /**
   * Run after validator subscriptions request.
   */
  onCommitteeSubscriptions(): void {
    // TODO:
    // Only if the slot is more than epoch away, add an event to start looking for peers

    // Request to run heartbeat fn
    this.heartbeat();
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  reStatusPeers(peers: PeerId[]): void {
    for (const peer of peers) {
      const peerData = this.connectedPeers.get(peer.toB58String());
      if (peerData) {
        // Set to 0 to trigger a status request after calling pingAndStatusTimeouts()
        peerData.lastStatusUnixTsMs = 0;
      }
    }
    this.pingAndStatusTimeouts();
  }

  /**
   * Must be called when network ReqResp receives incoming requests
   */
  private onRequest = (request: RequestTypedContainer, peer: PeerId): void => {
    try {
      const peerData = this.connectedPeers.get(peer.toB58String());
      if (peerData) {
        peerData.lastReceivedMsgUnixTsMs = Date.now();
      }

      switch (request.method) {
        case ReqRespMethod.Ping:
          return this.onPing(peer, request.body);
        case ReqRespMethod.Goodbye:
          return this.onGoodbye(peer, request.body);
        case ReqRespMethod.Status:
          return this.onStatus(peer, request.body);
      }
    } catch (e) {
      this.logger.error("Error onRequest handler", {}, e as Error);
    }
  };

  /**
   * Handle a PING request + response (rpc handler responds with PONG automatically)
   */
  private onPing(peer: PeerId, seqNumber: phase0.Ping): void {
    // if the sequence number is unknown update the peer's metadata
    const metadata = this.peerMetadata.metadata.get(peer);
    if (!metadata || metadata.seqNumber < seqNumber) {
      void this.requestMetadata(peer);
    }
  }

  /**
   * Handle a METADATA request + response (rpc handler responds with METADATA automatically)
   */
  private onMetadata(peer: PeerId, metadata: allForks.Metadata): void {
    // Store metadata always in case the peer updates attnets but not the sequence number
    // Trust that the peer always sends the latest metadata (From Lighthouse)
    this.peerMetadata.metadata.set(peer, {
      ...metadata,
      syncnets: (metadata as Partial<altair.Metadata>).syncnets || [],
    });
  }

  /**
   * Handle a GOODBYE request (rpc handler responds automatically)
   */
  private onGoodbye(peer: PeerId, goodbye: phase0.Goodbye): void {
    const reason = GOODBYE_KNOWN_CODES[goodbye.toString()] || "";
    this.logger.verbose("Received goodbye request", {peer: prettyPrintPeerId(peer), goodbye, reason});
    this.metrics?.peerGoodbyeReceived.inc({reason});

    // TODO: Consider register that we are banned, if discovery keeps attempting to connect to the same peers

    void this.disconnect(peer);
  }

  /**
   * Handle a STATUS request + response (rpc handler responds with STATUS automatically)
   */
  private onStatus(peer: PeerId, status: phase0.Status): void {
    // reset the to-status timer of this peer
    const peerData = this.connectedPeers.get(peer.toB58String());
    if (peerData) peerData.lastStatusUnixTsMs = Date.now();

    let isIrrelevant: boolean;
    try {
      const irrelevantReasonType = assertPeerRelevance(status, this.chain);
      if (irrelevantReasonType === null) {
        isIrrelevant = false;
      } else {
        isIrrelevant = true;
        this.logger.debug("Irrelevant peer", {
          peer: prettyPrintPeerId(peer),
          reason: renderIrrelevantPeerType(irrelevantReasonType),
        });
      }
    } catch (e) {
      this.logger.error("Irrelevant peer - unexpected error", {peer: prettyPrintPeerId(peer)}, e as Error);
      isIrrelevant = true;
    }

    if (isIrrelevant) {
      if (peerData) peerData.relevantStatus = RelevantPeerStatus.irrelevant;
      void this.goodbyeAndDisconnect(peer, GoodByeReasonCode.IRRELEVANT_NETWORK);
      return;
    }

    // Peer is usable, send it to the rangeSync
    // NOTE: Peer may not be connected anymore at this point, potential race condition
    // libp2p.connectionManager.get() returns not null if there's +1 open connections with `peer`
    if (peerData) peerData.relevantStatus = RelevantPeerStatus.relevant;
    if (this.libp2p.connectionManager.get(peer)) {
      this.networkEventBus.emit(NetworkEvent.peerConnected, peer, status);
    }
  }

  private async requestMetadata(peer: PeerId): Promise<void> {
    try {
      this.onMetadata(peer, await this.reqResp.metadata(peer));
    } catch (e) {
      // TODO: Downvote peer here or in the reqResp layer
    }
  }

  private async requestPing(peer: PeerId): Promise<void> {
    try {
      this.onPing(peer, await this.reqResp.ping(peer));
    } catch (e) {
      // TODO: Downvote peer here or in the reqResp layer
    }
  }

  private async requestStatus(peer: PeerId, localStatus: phase0.Status): Promise<void> {
    try {
      this.onStatus(peer, await this.reqResp.status(peer, localStatus));
    } catch (e) {
      // TODO: Failed to get peer latest status: downvote but don't disconnect
    }
  }

  private async requestStatusMany(peers: PeerId[]): Promise<void> {
    try {
      const localStatus = this.chain.getStatus();
      await Promise.all(peers.map(async (peer) => this.requestStatus(peer, localStatus)));
    } catch (e) {
      this.logger.verbose("Error requesting new status to peers", {}, e as Error);
    }
  }

  /**
   * The Peer manager's heartbeat maintains the peer count and maintains peer reputations.
   * It will request discovery queries if the peer count has not reached the desired number of peers.
   * NOTE: Discovery should only add a new query if one isn't already queued.
   */
  private heartbeat(): void {
    const connectedPeers = this.getConnectedPeerIds();

    // ban and disconnect peers with bad score, collect rest of healthy peers
    const connectedHealthyPeers: PeerId[] = [];
    for (const peer of connectedPeers) {
      // to decay score
      this.peerRpcScores.update(peer);
      switch (this.peerRpcScores.getScoreState(peer)) {
        case ScoreState.Banned:
          void this.goodbyeAndDisconnect(peer, GoodByeReasonCode.BANNED);
          break;
        case ScoreState.Disconnected:
          void this.goodbyeAndDisconnect(peer, GoodByeReasonCode.SCORE_TOO_LOW);
          break;
        case ScoreState.Healthy:
          connectedHealthyPeers.push(peer);
      }
    }

    const {peersToDisconnect, peersToConnect, attnetQueries, syncnetQueries} = prioritizePeers(
      connectedHealthyPeers.map((peer) => ({
        id: peer,
        attnets: this.peerMetadata.metadata.get(peer)?.attnets ?? [],
        syncnets: this.peerMetadata.metadata.get(peer)?.syncnets ?? [],
        score: this.peerRpcScores.getScore(peer),
      })),
      // Collect subnets which we need peers for in the current slot
      this.attnetsService.getActiveSubnets(),
      this.syncnetsService.getActiveSubnets(),
      this.opts
    );

    // Register results to metrics
    this.metrics?.peersRequestedToDisconnect.inc(peersToDisconnect.length);
    this.metrics?.peersRequestedToConnect.inc(peersToConnect);

    const queriesMerged: SubnetDiscvQueryMs[] = [];
    for (const {type, queries} of [
      {type: SubnetType.attnets, queries: attnetQueries},
      {type: SubnetType.syncnets, queries: syncnetQueries},
    ]) {
      if (queries.length > 0) {
        let count = 0;
        for (const query of queries) {
          count += query.maxPeersToDiscover;
          queriesMerged.push({
            subnet: query.subnet,
            type,
            maxPeersToDiscover: query.maxPeersToDiscover,
            toUnixMs: 1000 * (this.chain.genesisTime + query.toSlot * this.config.SECONDS_PER_SLOT),
          });
        }

        this.metrics?.peersRequestedSubnetsToQuery.inc({type}, queries.length);
        this.metrics?.peersRequestedSubnetsPeerCount.inc({type}, count);
      }
    }

    if (this.discovery) {
      try {
        this.discovery.discoverPeers(peersToConnect, queriesMerged);
      } catch (e) {
        this.logger.error("Error on discoverPeers", {}, e as Error);
      }
    }

    for (const peer of peersToDisconnect) {
      void this.goodbyeAndDisconnect(peer, GoodByeReasonCode.TOO_MANY_PEERS);
    }
  }

  private pingAndStatusTimeouts(): void {
    const now = Date.now();
    const peersToStatus: PeerId[] = [];

    for (const peer of this.connectedPeers.values()) {
      // Every interval request to send some peers our seqNumber and process theirs
      // If the seqNumber is different it must request the new metadata
      const pingInterval = peer.direction === "inbound" ? PING_INTERVAL_INBOUND_MS : PING_INTERVAL_OUTBOUND_MS;
      if (now > peer.lastReceivedMsgUnixTsMs + pingInterval) {
        void this.requestPing(peer.peerId);
      }

      // TODO: Consider sending status request to peers that do support status protocol
      // {supportsProtocols: getStatusProtocols()}

      // Every interval request to send some peers our status, and process theirs
      // Must re-check if this peer is relevant to us and emit an event if the status changes
      // So the sync layer can update things
      if (now > peer.lastStatusUnixTsMs + STATUS_INTERVAL_MS) {
        peersToStatus.push(peer.peerId);
      }
    }

    if (peersToStatus.length > 0) {
      void this.requestStatusMany(peersToStatus);
    }
  }

  /**
   * The libp2p Upgrader has successfully upgraded a peer connection on a particular multiaddress
   * This event is routed through the connectionManager
   *
   * Registers a peer as connected. The `direction` parameter determines if the peer is being
   * dialed or connecting to us.
   */
  private onLibp2pPeerConnect = (libp2pConnection: Connection): void => {
    const {direction, status} = libp2pConnection.stat;
    const peer = libp2pConnection.remotePeer;

    if (!this.connectedPeers.has(peer.toB58String())) {
      // On connection:
      // - Outbound connections: send a STATUS and PING request
      // - Inbound connections: expect to be STATUS'd, schedule STATUS and PING for latter
      // NOTE: libp2p may emit two "peer:connect" events: One for inbound, one for outbound
      // If that happens, it's okay. Only the "outbound" connection triggers immediate action
      const now = Date.now();
      this.connectedPeers.set(peer.toB58String(), {
        lastReceivedMsgUnixTsMs: direction === "outbound" ? 0 : now,
        // If inbound, request after STATUS_INBOUND_GRACE_PERIOD
        lastStatusUnixTsMs: direction === "outbound" ? 0 : now - STATUS_INTERVAL_MS + STATUS_INBOUND_GRACE_PERIOD,
        connectedUnixTsMs: now,
        relevantStatus: RelevantPeerStatus.Unknown,
        direction,
        peerId: peer,
      });

      if (direction === "outbound") {
        this.pingAndStatusTimeouts();
      }
    }

    this.logger.verbose("peer connected", {peer: prettyPrintPeerId(peer), direction, status});
    // NOTE: The peerConnect event is not emitted here here, but after asserting peer relevance
    this.metrics?.peerConnectedEvent.inc({direction});
  };

  /**
   * The libp2p Upgrader has ended a connection
   */
  private onLibp2pPeerDisconnect = (libp2pConnection: Connection): void => {
    const {direction, status} = libp2pConnection.stat;
    const peer = libp2pConnection.remotePeer;

    // remove the ping and status timer for the peer
    this.connectedPeers.delete(peer.toB58String());

    this.logger.verbose("peer disconnected", {peer: prettyPrintPeerId(peer), direction, status});
    this.networkEventBus.emit(NetworkEvent.peerDisconnected, peer);
    this.reqResp.pruneRateLimiterData(peer);
    this.metrics?.peerDisconnectedEvent.inc({direction});
  };

  private async disconnect(peer: PeerId): Promise<void> {
    try {
      await this.libp2p.hangUp(peer);
    } catch (e) {
      this.logger.warn("Unclean disconnect", {peer: prettyPrintPeerId(peer)}, e as Error);
    }
  }

  private async goodbyeAndDisconnect(peer: PeerId, goodbye: GoodByeReasonCode): Promise<void> {
    try {
      this.metrics?.peerGoodbyeSent.inc({reason: GOODBYE_KNOWN_CODES[goodbye.toString()] || ""});
      await this.reqResp.goodbye(peer, BigInt(goodbye));
    } catch (e) {
      this.logger.verbose("Failed to send goodbye", {peer: prettyPrintPeerId(peer)}, e as Error);
    } finally {
      void this.disconnect(peer);
    }
  }

  /** Register peer count metrics */
  private runPeerCountMetrics(metrics: IMetrics): void {
    let total = 0;
    const peersByDirection = new Map<string, number>();
    const peersByClient = new Map<string, number>();
    for (const connections of this.libp2p.connectionManager.connections.values()) {
      const openCnx = connections.find((cnx) => cnx.stat.status === "open");
      if (openCnx) {
        const direction = openCnx.stat.direction;
        peersByDirection.set(direction, 1 + (peersByDirection.get(direction) ?? 0));
        const client = getClientFromPeerStore(openCnx.remotePeer, this.libp2p.peerStore.metadataBook);
        peersByClient.set(client, 1 + (peersByClient.get(client) ?? 0));
        total++;
      }
    }

    for (const [direction, peers] of peersByDirection.entries()) {
      metrics.peersByDirection.set({direction}, peers);
    }

    for (const [client, peers] of peersByClient.entries()) {
      metrics.peersByClient.set({client}, peers);
    }

    let syncPeers = 0;
    for (const peer of this.connectedPeers.values()) {
      if (peer.relevantStatus === RelevantPeerStatus.relevant) {
        syncPeers++;
      }
    }

    metrics.peers.set(total);
    metrics.peersSync.set(syncPeers);
  }
}
