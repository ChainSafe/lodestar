import {BitArray} from "@chainsafe/ssz";
import {Connection, PeerId, PrivateKey} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {LoggerNode} from "@lodestar/logger/node";
import {ForkSeq, SLOTS_PER_EPOCH, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {Metadata, Status, altair, fulu, phase0} from "@lodestar/types";
import {prettyPrintIndices, toHex, withTimeout} from "@lodestar/utils";
import {GOODBYE_KNOWN_CODES, GoodByeReasonCode, Libp2pEvent} from "../../constants/index.js";
import {IClock} from "../../util/clock.js";
import {computeColumnsForCustodyGroup, getCustodyGroups} from "../../util/dataColumns.js";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {LodestarDiscv5Opts} from "../discv5/types.js";
import {INetworkEventBus, NetworkEvent, NetworkEventData} from "../events.js";
import {Eth2Gossipsub} from "../gossip/gossipsub.js";
import {Libp2p} from "../interface.js";
import {SubnetType} from "../metadata.js";
import {NetworkConfig} from "../networkConfig.js";
import {ReqRespMethod} from "../reqresp/ReqRespBeaconNode.js";
import {StatusCache} from "../statusCache.js";
import {NodeId, SubnetsService, computeNodeId} from "../subnets/index.js";
import {getConnection, getConnectionsMap, prettyPrintPeerId, prettyPrintPeerIdStr} from "../util.js";
import {ClientKind, getKnownClientFromAgentVersion} from "./client.js";
import {PeerDiscovery, SubnetDiscvQueryMs} from "./discover.js";
import {PeerData, PeersData} from "./peersData.js";
import {NO_COOL_DOWN_APPLIED} from "./score/constants.js";
import {IPeerRpcScoreStore, PeerAction, PeerScoreStats, ScoreState, updateGossipsubScores} from "./score/index.js";
import {
  assertPeerRelevance,
  getConnectedPeerIds,
  hasSomeConnectedPeer,
  prioritizePeers,
  renderIrrelevantPeerType,
} from "./utils/index.js";

/** heartbeat performs regular updates such as updating reputations and performing discovery requests */
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
/** The time in seconds between PING events. We do not send a ping if the other peer has PING'd us */
const PING_INTERVAL_INBOUND_MS = 15 * 1000; // Offset to not ping when outbound reqs
const PING_INTERVAL_OUTBOUND_MS = 20 * 1000;
/** The time in seconds between re-status's peers. */
const STATUS_INTERVAL_MS = 5 * 60 * 1000;
/** Expect a STATUS request from on inbound peer for some time. Afterwards the node does a request */
const STATUS_INBOUND_GRACE_PERIOD = 15 * 1000;
/** Internal interval to check PING and STATUS timeouts */
const CHECK_PING_STATUS_INTERVAL = 10 * 1000;
/** A peer is considered long connection if it's >= 1 day */
const LONG_PEER_CONNECTION_MS = 24 * 60 * 60 * 1000;
/** Ref https://github.com/ChainSafe/lodestar/issues/3423 */
const DEFAULT_DISCV5_FIRST_QUERY_DELAY_MS = 1000;
/**
 * Tag peer when it's relevant and connecting to our node.
 * When node has > maxPeer (55), libp2p randomly prune peers if we don't tag peers in use.
 * See https://github.com/ChainSafe/lodestar/issues/4623#issuecomment-1374447934
 **/
const PEER_RELEVANT_TAG = "relevant";
/** Tag value of PEER_RELEVANT_TAG */
const PEER_RELEVANT_TAG_VALUE = 100;

/** Change pruning behavior once the head falls behind */
const STARVATION_THRESHOLD_SLOTS = SLOTS_PER_EPOCH * 2;
/** Percentage of peers to attempt to prune when starvation threshold is met */
const STARVATION_PRUNE_RATIO = 0.05;

/**
 * Relative factor of peers that are allowed to have a negative gossipsub score without penalizing them in lodestar.
 */
const ALLOWED_NEGATIVE_GOSSIPSUB_FACTOR = 0.1;

// TODO:
// maxPeers and targetPeers should be dynamic on the num of validators connected
// The Node should compute a recommended value every interval and log a warning
// to terminal if it deviates significantly from the user's settings

export type PeerManagerOpts = {
  /** The target number of peers we would like to connect to. */
  targetPeers: number;
  /** The maximum number of peers we allow (exceptions for subnet peers) */
  maxPeers: number;
  /** Target peer per PeerDAS group */
  targetGroupPeers: number;
  /**
   * Delay the 1st query after starting discv5
   * See https://github.com/ChainSafe/lodestar/issues/3423
   */
  discv5FirstQueryDelayMs?: number;
  /**
   * If null, Don't run discv5 queries, nor connect to cached peers in the peerStore
   */
  discv5: LodestarDiscv5Opts | null;
  /**
   * If set to true, connect to Discv5 bootnodes. If not set or false, do not connect
   */
  connectToDiscv5Bootnodes?: boolean;
};

/**
 * ReqResp methods used only be PeerManager, so the main thread never has to call them
 */
export interface IReqRespBeaconNodePeerManager {
  sendPing(peerId: PeerId): Promise<phase0.Ping>;
  sendStatus(peerId: PeerId, request: Status): Promise<Status>;
  sendGoodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void>;
  sendMetadata(peerId: PeerId): Promise<Metadata>;
}

export type PeerManagerModules = {
  privateKey: PrivateKey;
  libp2p: Libp2p;
  logger: LoggerNode;
  metrics: NetworkCoreMetrics | null;
  reqResp: IReqRespBeaconNodePeerManager;
  gossip: Eth2Gossipsub;
  attnetsService: SubnetsService;
  syncnetsService: SubnetsService;
  clock: IClock;
  peerRpcScores: IPeerRpcScoreStore;
  events: INetworkEventBus;
  networkConfig: NetworkConfig;
  peersData: PeersData;
  statusCache: StatusCache;
};

export type PeerRequestedSubnetType = SubnetType | "column";

type PeerIdStr = string;

// TODO(fulu): dedupe with network/peers/peerData.ts
enum RelevantPeerStatus {
  Unknown = "unknown",
  relevant = "relevant",
  irrelevant = "irrelevant",
}

/**
 * Performs all peer management functionality in a single grouped class:
 * - Ping peers every `PING_INTERVAL_MS`
 * - Status peers every `STATUS_INTERVAL_MS`
 * - Execute discovery query if under target peers
 * - Execute discovery query if need peers on some subnet: TODO
 * - Disconnect peers if over target peers
 */
export class PeerManager {
  private nodeId: NodeId;
  private readonly libp2p: Libp2p;
  private readonly logger: LoggerNode;
  private readonly metrics: NetworkCoreMetrics | null;
  private readonly reqResp: IReqRespBeaconNodePeerManager;
  private readonly gossipsub: Eth2Gossipsub;
  private readonly attnetsService: SubnetsService;
  private readonly syncnetsService: SubnetsService;
  private readonly clock: IClock;
  private readonly networkConfig: NetworkConfig;
  private readonly config: BeaconConfig;
  private readonly peerRpcScores: IPeerRpcScoreStore;
  /** If null, discovery is disabled */
  private readonly discovery: PeerDiscovery | null;
  private readonly networkEventBus: INetworkEventBus;
  private readonly statusCache: StatusCache;
  private lastStatus: Status;

  // A single map of connected peers with all necessary data to handle PINGs, STATUS, and metrics
  private connectedPeers: Map<PeerIdStr, PeerData>;

  private opts: PeerManagerOpts;
  private intervals: NodeJS.Timeout[] = [];

  constructor(modules: PeerManagerModules, opts: PeerManagerOpts, discovery: PeerDiscovery | null) {
    const {networkConfig} = modules;
    this.libp2p = modules.libp2p;
    this.logger = modules.logger;
    this.metrics = modules.metrics;
    this.reqResp = modules.reqResp;
    this.gossipsub = modules.gossip;
    this.attnetsService = modules.attnetsService;
    this.syncnetsService = modules.syncnetsService;
    this.statusCache = modules.statusCache;
    this.clock = modules.clock;
    this.networkConfig = networkConfig;
    this.config = networkConfig.config;
    this.peerRpcScores = modules.peerRpcScores;
    this.networkEventBus = modules.events;
    this.connectedPeers = modules.peersData.connectedPeers;
    this.opts = opts;
    this.discovery = discovery;
    this.nodeId = networkConfig.nodeId;

    const {metrics} = modules;
    if (metrics) {
      metrics.peers.addCollect(() => this.runPeerCountMetrics(metrics));
    }

    this.libp2p.services.components.events.addEventListener(Libp2pEvent.connectionOpen, this.onLibp2pPeerConnect);
    this.libp2p.services.components.events.addEventListener(Libp2pEvent.connectionClose, this.onLibp2pPeerDisconnect);
    this.networkEventBus.on(NetworkEvent.reqRespRequest, this.onRequest);

    this.lastStatus = this.statusCache.get();

    // On start-up will connected to existing peers in libp2p.peerStore, same as autoDial behaviour
    this.heartbeat();
    this.intervals = [
      setInterval(this.pingAndStatusTimeouts.bind(this), CHECK_PING_STATUS_INTERVAL),
      setInterval(this.heartbeat.bind(this), HEARTBEAT_INTERVAL_MS),
      setInterval(
        this.updateGossipsubScores.bind(this),
        this.gossipsub.scoreParams.decayInterval ?? HEARTBEAT_INTERVAL_MS
      ),
    ];
  }

  static async init(modules: PeerManagerModules, opts: PeerManagerOpts): Promise<PeerManager> {
    // opts.discv5 === null, discovery is disabled
    const discovery = opts.discv5
      ? await PeerDiscovery.init(modules, {
          discv5FirstQueryDelayMs: opts.discv5FirstQueryDelayMs ?? DEFAULT_DISCV5_FIRST_QUERY_DELAY_MS,
          discv5: opts.discv5,
          connectToDiscv5Bootnodes: opts.connectToDiscv5Bootnodes,
        })
      : null;

    return new PeerManager(modules, opts, discovery);
  }

  async close(): Promise<void> {
    await this.discovery?.stop();
    this.libp2p.services.components.events.removeEventListener(Libp2pEvent.connectionOpen, this.onLibp2pPeerConnect);
    this.libp2p.services.components.events.removeEventListener(
      Libp2pEvent.connectionClose,
      this.onLibp2pPeerDisconnect
    );
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

  reportPeer(peer: PeerId, action: PeerAction, actionName: string): void {
    this.peerRpcScores.applyAction(peer, action, actionName);
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  reStatusPeers(peers: PeerIdStr[]): void {
    for (const peer of peers) {
      const peerData = this.connectedPeers.get(peer);
      if (peerData) {
        // Set to 0 to trigger a status request after calling pingAndStatusTimeouts()
        peerData.lastStatusUnixTsMs = 0;
      }
    }
    this.pingAndStatusTimeouts();
  }

  dumpPeerScoreStats(): PeerScoreStats {
    return this.peerRpcScores.dumpPeerScoreStats();
  }

  /**
   * Must be called when network ReqResp receives incoming requests
   */
  private onRequest = ({peer, request}: NetworkEventData[NetworkEvent.reqRespRequest]): void => {
    try {
      const peerData = this.connectedPeers.get(peer.toString());
      if (peerData) {
        peerData.lastReceivedMsgUnixTsMs = Date.now();
      }

      switch (request.method) {
        case ReqRespMethod.Ping:
          this.onPing(peer, request.body);
          return;
        case ReqRespMethod.Goodbye:
          this.onGoodbye(peer, request.body);
          return;
        case ReqRespMethod.Status:
          this.onStatus(peer, request.body);
          return;
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
    const metadata = this.connectedPeers.get(peer.toString())?.metadata;
    if (!metadata || metadata.seqNumber < seqNumber) {
      void this.requestMetadata(peer);
    }
  }

  /**
   * Handle a METADATA request + response (rpc handler responds with METADATA automatically)
   */
  private onMetadata(peer: PeerId, metadata: Metadata): void {
    // Store metadata always in case the peer updates attnets but not the sequence number
    // Trust that the peer always sends the latest metadata (From Lighthouse)
    const peerData = this.connectedPeers.get(peer.toString());
    this.logger.debug("onMetadata", {
      peer: peer.toString(),
      peerData: peerData !== undefined,
      custodyGroupCount: (metadata as Partial<fulu.Metadata>)?.custodyGroupCount,
    });
    if (peerData) {
      const oldMetadata = peerData.metadata;
      const custodyGroupCount =
        (metadata as Partial<fulu.Metadata>).custodyGroupCount ?? this.config.CUSTODY_REQUIREMENT;
      const samplingGroupCount = Math.max(this.config.SAMPLES_PER_SLOT, custodyGroupCount);
      const nodeId = peerData?.nodeId ?? computeNodeId(peer);
      const custodyGroups =
        oldMetadata == null || oldMetadata.custodyGroups == null || custodyGroupCount !== oldMetadata.custodyGroupCount
          ? getCustodyGroups(this.config, nodeId, custodyGroupCount)
          : oldMetadata.custodyGroups;
      const oldSamplingGroupCount = Math.max(this.config.SAMPLES_PER_SLOT, oldMetadata?.custodyGroupCount ?? 0);
      const samplingGroups =
        oldMetadata == null || oldMetadata.samplingGroups == null || samplingGroupCount !== oldSamplingGroupCount
          ? getCustodyGroups(this.config, nodeId, samplingGroupCount)
          : oldMetadata.samplingGroups;
      peerData.metadata = {
        seqNumber: metadata.seqNumber,
        attnets: metadata.attnets,
        syncnets: (metadata as Partial<altair.Metadata>).syncnets ?? BitArray.fromBitLen(SYNC_COMMITTEE_SUBNET_COUNT),
        custodyGroupCount:
          (metadata as Partial<fulu.Metadata>).custodyGroupCount ??
          // TODO: spec says that Clients MAY reject peers with a value less than CUSTODY_REQUIREMENT
          this.config.CUSTODY_REQUIREMENT,
        // TODO(fulu): this should be columns not groups.  need to change everywhere. we consume columns and should
        //      cache that instead so if groups->columns ever changes from 1-1 we only need to update that here
        custodyGroups,
        samplingGroups,
      };
      if (oldMetadata === null || oldMetadata.custodyGroupCount !== peerData.metadata.custodyGroupCount) {
        void this.requestStatus(peer, this.statusCache.get());
      }
    }
  }

  /**
   * Handle a GOODBYE request (rpc handler responds automatically)
   */
  private onGoodbye(peer: PeerId, goodbye: phase0.Goodbye): void {
    const reason = GOODBYE_KNOWN_CODES[goodbye.toString()] || "";
    this.logger.verbose("Received goodbye request", {peer: prettyPrintPeerId(peer), goodbye, reason});
    this.metrics?.peerGoodbyeReceived.inc({reason});

    const conn = getConnection(this.libp2p, peer.toString());
    if (conn && Date.now() - conn.timeline.open > LONG_PEER_CONNECTION_MS) {
      this.metrics?.peerLongConnectionDisconnect.inc({reason});
    }

    void this.disconnect(peer);
  }

  /**
   * Handle a STATUS request + response (rpc handler responds with STATUS automatically)
   */
  private onStatus(peer: PeerId, status: Status): void {
    // reset the to-status timer of this peer
    const peerData = this.connectedPeers.get(peer.toString());
    if (peerData) {
      peerData.lastStatusUnixTsMs = Date.now();
      peerData.status = status;
    }

    const forkName = this.config.getForkName(this.clock.currentSlot);

    let isIrrelevant: boolean;
    try {
      const irrelevantReasonType = assertPeerRelevance(
        forkName,
        status,
        this.statusCache.get(),
        this.clock.currentSlot
      );
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
    if (peerData && peerData.relevantStatus !== RelevantPeerStatus.relevant) {
      this.libp2p.peerStore
        .merge(peer, {
          // ttl = undefined means it's never expired
          tags: {[PEER_RELEVANT_TAG]: {ttl: undefined, value: PEER_RELEVANT_TAG_VALUE}},
        })
        .catch((e) => this.logger.verbose("cannot tag peer", {peerId: peer.toString()}, e as Error));
      peerData.relevantStatus = RelevantPeerStatus.relevant;
    }
    if (getConnection(this.libp2p, peer.toString())) {
      const nodeId = peerData?.nodeId ?? computeNodeId(peer);
      // TODO(fulu): Are we sure we've run Metadata before this?
      const custodyGroupCount = peerData?.metadata?.custodyGroupCount ?? this.config.CUSTODY_REQUIREMENT;
      const custodyGroups =
        peerData?.metadata?.custodyGroups ?? getCustodyGroups(this.config, nodeId, custodyGroupCount);
      const custodyColumns = custodyGroups
        .flatMap((g) => computeColumnsForCustodyGroup(this.config, g))
        .sort((a, b) => a - b);

      const sampleSubnets = this.networkConfig.custodyConfig.sampledSubnets;
      const matchingSubnetsNum = sampleSubnets.reduce((acc, elem) => acc + (custodyColumns.includes(elem) ? 1 : 0), 0);
      const hasAllColumns = matchingSubnetsNum === sampleSubnets.length;
      const clientAgent = peerData?.agentClient ?? ClientKind.Unknown;

      this.logger.debug("onStatus", {
        nodeId: toHex(nodeId),
        myNodeId: toHex(this.nodeId),
        peerId: peer.toString(),
        custodyGroupCount,
        hasAllColumns,
        matchingSubnetsNum,
        custodyGroups: prettyPrintIndices(custodyGroups),
        custodyColumns: prettyPrintIndices(custodyColumns),
        mySampleSubnets: prettyPrintIndices(sampleSubnets),
        clientAgent,
      });

      this.networkEventBus.emit(NetworkEvent.peerConnected, {
        peer: peer.toString(),
        status,
        clientAgent,
        custodyColumns,
      });
    }
  }

  private async requestMetadata(peer: PeerId): Promise<void> {
    const peerIdStr = peer.toString();
    try {
      this.onMetadata(peer, await this.reqResp.sendMetadata(peer));
    } catch (e) {
      this.logger.verbose("invalid requestMetadata", {peer: prettyPrintPeerIdStr(peerIdStr)}, e as Error);
      // TODO: Downvote peer here or in the reqResp layer
    }
  }

  private async requestPing(peer: PeerId): Promise<void> {
    const peerIdStr = peer.toString();
    try {
      this.onPing(peer, await this.reqResp.sendPing(peer));

      // If peer replies a PING request also update lastReceivedMsg
      const peerData = this.connectedPeers.get(peer.toString());
      if (peerData) peerData.lastReceivedMsgUnixTsMs = Date.now();
    } catch (e) {
      this.logger.verbose("invalid requestPing", {peer: prettyPrintPeerIdStr(peerIdStr)}, e as Error);
      // TODO: Downvote peer here or in the reqResp layer
    }
  }

  private async requestStatus(peer: PeerId, localStatus: Status): Promise<void> {
    const peerIdStr = peer.toString();
    try {
      this.onStatus(peer, await this.reqResp.sendStatus(peer, localStatus));
    } catch (e) {
      this.logger.verbose("invalid requestStatus", {peer: prettyPrintPeerIdStr(peerIdStr)}, e as Error);
      // TODO: Failed to get peer latest status: downvote but don't disconnect
    }
  }

  private async requestStatusMany(peers: PeerId[]): Promise<void> {
    try {
      const localStatus = this.statusCache.get();
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
    // timer is safe without a try {} catch (_e) {}, in case of error the metric won't register and timer is GC'ed
    const timer = this.metrics?.peerManager.heartbeatDuration.startTimer();

    const connectedPeers = this.getConnectedPeerIds();

    // Decay scores before reading them. Also prunes scores
    this.peerRpcScores.update();

    // ban and disconnect peers with bad score, collect rest of healthy peers
    const connectedHealthyPeers: PeerId[] = [];
    for (const peer of connectedPeers) {
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

    const status = this.statusCache.get();
    const starved =
      // while syncing progress is happening, we aren't starved
      this.lastStatus.headSlot === status.headSlot &&
      // if the head falls behind the threshold, we are starved
      this.clock.currentSlot - status.headSlot > STARVATION_THRESHOLD_SLOTS;
    this.lastStatus = status;
    this.metrics?.peerManager.starved.set(starved ? 1 : 0);
    const forkSeq = this.config.getForkSeq(this.clock.currentSlot);

    const {peersToDisconnect, peersToConnect, attnetQueries, syncnetQueries, custodyGroupQueries} = prioritizePeers(
      connectedHealthyPeers.map((peer) => {
        const peerData = this.connectedPeers.get(peer.toString());
        return {
          id: peer,
          direction: peerData?.direction ?? null,
          status: peerData?.status ?? null,
          attnets: peerData?.metadata?.attnets ?? null,
          syncnets: peerData?.metadata?.syncnets ?? null,
          // here we care samplingGroups not custodyGroups in order to know which column subnets peers subscribe to
          samplingGroups: peerData?.metadata?.samplingGroups ?? null,
          score: this.peerRpcScores.getScore(peer),
        };
      }),
      // Collect subnets which we need peers for in the current slot
      this.attnetsService.getActiveSubnets(),
      this.syncnetsService.getActiveSubnets(),
      // ignore samplingGroups for pre-fulu forks
      forkSeq >= ForkSeq.fulu ? this.networkConfig.custodyConfig.sampleGroups : undefined,
      {
        ...this.opts,
        status,
        starved,
        starvationPruneRatio: STARVATION_PRUNE_RATIO,
        starvationThresholdSlots: STARVATION_THRESHOLD_SLOTS,
      },
      this.config,
      this.metrics
    );

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
            toUnixMs: 1000 * (this.clock.genesisTime + query.toSlot * this.config.SECONDS_PER_SLOT),
          });
        }

        this.metrics?.peersRequestedSubnetsToQuery.inc({type}, queries.length);
        this.metrics?.peersRequestedSubnetsPeerCount.inc({type}, count);
      }
    }

    for (const maxPeersToDiscover of custodyGroupQueries.values()) {
      this.metrics?.peersRequestedSubnetsToQuery.inc({type: "column"}, 1);
      this.metrics?.peersRequestedSubnetsPeerCount.inc({type: "column"}, maxPeersToDiscover);
    }

    // disconnect first to have more slots before we dial new peers
    for (const [reason, peers] of peersToDisconnect) {
      this.metrics?.peersRequestedToDisconnect.inc({reason}, peers.length);
      for (const peer of peers) {
        void this.goodbyeAndDisconnect(peer, GoodByeReasonCode.TOO_MANY_PEERS);
      }
    }

    if (this.discovery) {
      try {
        this.metrics?.peersRequestedToConnect.inc(peersToConnect);
        // for PeerDAS, lodestar implements subnet sampling strategy, hence we need to issue columnSubnetQueries to PeerDiscovery
        this.discovery.discoverPeers(peersToConnect, custodyGroupQueries, queriesMerged);
      } catch (e) {
        this.logger.error("Error on discoverPeers", {}, e as Error);
      }
    }

    // Prune connectedPeers map in case it leaks. It has happen in previous nodes,
    // disconnect is not always called for all peers
    if (this.connectedPeers.size > connectedPeers.length * 1.1) {
      const actualConnectedPeerIds = new Set(connectedPeers.map((peerId) => peerId.toString()));
      for (const peerIdStr of this.connectedPeers.keys()) {
        if (!actualConnectedPeerIds.has(peerIdStr)) {
          this.connectedPeers.delete(peerIdStr);
          this.metrics?.leakedConnectionsCount.inc();
        }
      }
    }

    timer?.();

    this.logger.debug("peerManager heartbeat result", {
      peersToDisconnect: peersToDisconnect.size,
      peersToConnect: peersToConnect,
      attnetQueries: attnetQueries.length,
      syncnetQueries: syncnetQueries.length,
    });
  }

  private updateGossipsubScores(): void {
    const gossipsubScores = new Map<string, number>();
    for (const peerIdStr of this.connectedPeers.keys()) {
      gossipsubScores.set(peerIdStr, this.gossipsub.getScore(peerIdStr));
    }

    const toIgnoreNegativePeers = Math.ceil(this.opts.targetPeers * ALLOWED_NEGATIVE_GOSSIPSUB_FACTOR);
    updateGossipsubScores(this.peerRpcScores, gossipsubScores, toIgnoreNegativePeers);
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
  private onLibp2pPeerConnect = async (evt: CustomEvent<Connection>): Promise<void> => {
    const {direction, status, remotePeer} = evt.detail;
    const remotePeerStr = remotePeer.toString();
    const remotePeerPrettyStr = prettyPrintPeerId(remotePeer);
    this.logger.verbose("peer connected", {peer: remotePeerPrettyStr, direction, status});
    // NOTE: The peerConnect event is not emitted here here, but after asserting peer relevance
    this.metrics?.peerConnectedEvent.inc({direction, status});

    if (evt.detail.status !== "open") {
      this.logger.debug("Peer disconnected before identify protocol initiated", {
        peerId: remotePeerPrettyStr,
        status: evt.detail.status,
      });
      return;
    }

    // On connection:
    // - Outbound connections: send a STATUS and PING request
    // - Inbound connections: expect to be STATUS'd, schedule STATUS and PING for latter
    // NOTE: libp2p may emit two "peer:connect" events: One for inbound, one for outbound
    // If that happens, it's okay. Only the "outbound" connection triggers immediate action
    const now = Date.now();
    const nodeId = computeNodeId(remotePeer);
    const peerData: PeerData = {
      lastReceivedMsgUnixTsMs: direction === "outbound" ? 0 : now,
      // If inbound, request after STATUS_INBOUND_GRACE_PERIOD
      lastStatusUnixTsMs: direction === "outbound" ? 0 : now - STATUS_INTERVAL_MS + STATUS_INBOUND_GRACE_PERIOD,
      connectedUnixTsMs: now,
      relevantStatus: RelevantPeerStatus.Unknown,
      direction,
      nodeId,
      peerId: remotePeer,
      status: null,
      metadata: null,
      agentVersion: null,
      agentClient: null,
      encodingPreference: null,
    };
    this.connectedPeers.set(remotePeerStr, peerData);

    if (direction === "outbound") {
      // this.pingAndStatusTimeouts();
      void this.requestPing(remotePeer);
      void this.requestStatus(remotePeer, this.statusCache.get());
    }

    this.libp2p.services.identify
      .identify(evt.detail)
      .then((result) => {
        const agentVersion = result.agentVersion;
        if (agentVersion) {
          peerData.agentVersion = agentVersion;
          peerData.agentClient = getKnownClientFromAgentVersion(agentVersion);
        }
      })
      .catch((err) => {
        if (evt.detail.status !== "open") {
          this.logger.debug("Peer disconnected during identify protocol", {
            peerId: remotePeerPrettyStr,
            error: (err as Error).message,
          });
        } else {
          this.logger.debug("Error setting agentVersion for the peer", {peerId: remotePeerPrettyStr}, err);
        }
      });
  };

  /**
   * The libp2p Upgrader has ended a connection
   */
  private onLibp2pPeerDisconnect = (evt: CustomEvent<Connection>): void => {
    const {direction, status, remotePeer} = evt.detail;
    const peerIdStr = remotePeer.toString();

    let logMessage = "onLibp2pPeerDisconnect";
    const logContext: Record<string, string | number> = {
      peerId: prettyPrintPeerIdStr(peerIdStr),
      direction,
      status,
    };
    // Some clients do not send good-bye requests (Nimbus) so check for inbound disconnects and apply reconnection
    // cool-down period to prevent automatic reconnection by Discovery
    if (direction === "inbound") {
      // prevent automatic/immediate reconnects
      const coolDownMin = this.peerRpcScores.applyReconnectionCoolDown(peerIdStr, GoodByeReasonCode.INBOUND_DISCONNECT);
      logMessage += ". Enforcing a reconnection cool-down period";
      logContext.coolDownMin = coolDownMin;
    }

    // remove the ping and status timer for the peer
    this.connectedPeers.delete(peerIdStr);

    this.logger.verbose(logMessage, logContext);
    this.networkEventBus.emit(NetworkEvent.peerDisconnected, {peer: peerIdStr});
    this.metrics?.peerDisconnectedEvent.inc({direction});
    this.libp2p.peerStore
      .merge(remotePeer, {tags: {[PEER_RELEVANT_TAG]: undefined}})
      .catch((e) => this.logger.verbose("cannot untag peer", {peerId: peerIdStr}, e as Error));
  };

  private async disconnect(peer: PeerId): Promise<void> {
    try {
      await this.libp2p.hangUp(peer);
    } catch (e) {
      this.logger.debug("Unclean disconnect", {peer: prettyPrintPeerId(peer)}, e as Error);
    }
  }

  private async goodbyeAndDisconnect(peer: PeerId, goodbye: GoodByeReasonCode): Promise<void> {
    const reason = GOODBYE_KNOWN_CODES[goodbye.toString()] || "";
    const peerIdStr = peer.toString();
    try {
      this.metrics?.peerGoodbyeSent.inc({reason});
      this.logger.debug("initiating goodbyeAndDisconnect peer", {reason, peerId: prettyPrintPeerId(peer)});

      const conn = getConnection(this.libp2p, peerIdStr);
      if (conn && Date.now() - conn.timeline.open > LONG_PEER_CONNECTION_MS) {
        this.metrics?.peerLongConnectionDisconnect.inc({reason});
      }

      // Wrap with shorter timeout than regular ReqResp requests to speed up shutdown
      await withTimeout(() => this.reqResp.sendGoodbye(peer, BigInt(goodbye)), 1_000);
    } catch (e) {
      this.logger.verbose("Failed to send goodbye", {peer: prettyPrintPeerId(peer)}, e as Error);
    } finally {
      await this.disconnect(peer);
      // prevent automatic/immediate reconnects
      const coolDownMin = this.peerRpcScores.applyReconnectionCoolDown(peerIdStr, goodbye);
      if (coolDownMin === NO_COOL_DOWN_APPLIED) {
        this.logger.verbose("Disconnected a peer", {peerId: prettyPrintPeerIdStr(peerIdStr)});
      } else {
        this.logger.verbose("Disconnected a peer. Enforcing a reconnection cool-down period", {
          peerId: prettyPrintPeerIdStr(peerIdStr),
          coolDownMin,
        });
      }
    }
  }

  /** Register peer count metrics */
  private async runPeerCountMetrics(metrics: NetworkCoreMetrics): Promise<void> {
    let total = 0;

    const peersByDirection = new Map<string, number>();
    const peersByClient = new Map<string, number>();
    const now = Date.now();

    // peerLongLivedAttnets metric is a count
    metrics.peerLongLivedAttnets.reset();
    metrics.peerScoreByClient.reset();
    metrics.peerConnectionLength.reset();
    metrics.peerGossipScoreByClient.reset();

    // reset client counts _for each client_ to 0
    for (const client of Object.values(ClientKind)) {
      peersByClient.set(client, 0);
    }

    for (const connections of getConnectionsMap(this.libp2p).values()) {
      const openCnx = connections.value.find((cnx) => cnx.status === "open");
      if (openCnx) {
        const direction = openCnx.direction;
        peersByDirection.set(direction, 1 + (peersByDirection.get(direction) ?? 0));
        const peerId = openCnx.remotePeer;
        const peerData = this.connectedPeers.get(peerId.toString());
        const client = peerData?.agentClient ?? ClientKind.Unknown;
        peersByClient.set(client, 1 + (peersByClient.get(client) ?? 0));

        const attnets = peerData?.metadata?.attnets;

        // TODO: Consider optimizing by doing observe in batch
        metrics.peerLongLivedAttnets.observe(attnets ? attnets.getTrueBitIndexes().length : 0);
        metrics.peerColumnGroupCount.observe(peerData?.metadata?.custodyGroupCount ?? 0);
        metrics.peerScoreByClient.observe({client}, this.peerRpcScores.getScore(peerId));
        metrics.peerGossipScoreByClient.observe({client}, this.peerRpcScores.getGossipScore(peerId));
        metrics.peerConnectionLength.observe((now - openCnx.timeline.open) / 1000);
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
