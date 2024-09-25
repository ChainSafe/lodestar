import {Multiaddr} from "@multiformats/multiaddr";
import type {PeerId, PeerInfo} from "@libp2p/interface";
import {ENR} from "@chainsafe/enr";
import {BeaconConfig} from "@lodestar/config";
import {pruneSetToMax, sleep} from "@lodestar/utils";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {LoggerNode} from "@lodestar/logger/node";
import {NetworkCoreMetrics} from "../core/metrics.js";
import {Libp2p} from "../interface.js";
import {ENRKey, SubnetType} from "../metadata.js";
import {getConnectionsMap, prettyPrintPeerId} from "../util.js";
import {Discv5Worker} from "../discv5/index.js";
import {LodestarDiscv5Opts} from "../discv5/types.js";
import {deserializeEnrSubnets, zeroAttnets, zeroSyncnets} from "./utils/enrSubnetsDeserialize.js";
import {IPeerRpcScoreStore, ScoreState} from "./score/index.js";

/** Max number of cached ENRs after discovering a good peer */
const MAX_CACHED_ENRS = 100;
/** Max age a cached ENR will be considered for dial */
const MAX_CACHED_ENR_AGE_MS = 5 * 60 * 1000;

export type PeerDiscoveryOpts = {
  maxPeers: number;
  discv5FirstQueryDelayMs: number;
  discv5: LodestarDiscv5Opts;
  connectToDiscv5Bootnodes?: boolean;
};

export type PeerDiscoveryModules = {
  libp2p: Libp2p;
  peerRpcScores: IPeerRpcScoreStore;
  metrics: NetworkCoreMetrics | null;
  logger: LoggerNode;
  config: BeaconConfig;
};

type PeerIdStr = string;

enum QueryStatusCode {
  NotActive,
  Active,
}
type QueryStatus = {code: QueryStatusCode.NotActive} | {code: QueryStatusCode.Active; count: number};

export enum DiscoveredPeerStatus {
  bad_score = "bad_score",
  already_connected = "already_connected",
  already_dialing = "already_dialing",
  error = "error",
  attempt_dial = "attempt_dial",
  cached = "cached",
  dropped = "dropped",
  no_multiaddrs = "no_multiaddrs",
}

type UnixMs = number;
/**
 * Maintain peersToConnect to avoid having too many topic peers at some point.
 * See https://github.com/ChainSafe/lodestar/issues/5741#issuecomment-1643113577
 */
type SubnetRequestInfo = {
  toUnixMs: UnixMs;
  // when node is stable this should be 0
  peersToConnect: number;
};

export type SubnetDiscvQueryMs = {
  subnet: number;
  type: SubnetType;
  toUnixMs: UnixMs;
  maxPeersToDiscover: number;
};

type CachedENR = {
  peerId: PeerId;
  multiaddrTCP: Multiaddr;
  subnets: Record<SubnetType, boolean[]>;
  addedUnixMs: number;
};

/**
 * PeerDiscovery discovers and dials new peers, and executes discv5 queries.
 * Currently relies on discv5 automatic periodic queries.
 */
export class PeerDiscovery {
  readonly discv5: Discv5Worker;
  private libp2p: Libp2p;
  private peerRpcScores: IPeerRpcScoreStore;
  private metrics: NetworkCoreMetrics | null;
  private logger: LoggerNode;
  private config: BeaconConfig;
  private cachedENRs = new Map<PeerIdStr, CachedENR>();
  private randomNodeQuery: QueryStatus = {code: QueryStatusCode.NotActive};
  private peersToConnect = 0;
  private subnetRequests: Record<SubnetType, Map<number, SubnetRequestInfo>> = {
    attnets: new Map(),
    syncnets: new Map(),
  };

  /** The maximum number of peers we allow (exceptions for subnet peers) */
  private maxPeers: number;
  private discv5StartMs: number;
  private discv5FirstQueryDelayMs: number;

  private connectToDiscv5BootnodesOnStart: boolean | undefined = false;

  constructor(modules: PeerDiscoveryModules, opts: PeerDiscoveryOpts, discv5: Discv5Worker) {
    const {libp2p, peerRpcScores, metrics, logger, config} = modules;
    this.libp2p = libp2p;
    this.peerRpcScores = peerRpcScores;
    this.metrics = metrics;
    this.logger = logger;
    this.config = config;
    this.discv5 = discv5;
    this.maxPeers = opts.maxPeers;
    this.discv5StartMs = 0;
    this.discv5StartMs = Date.now();
    this.discv5FirstQueryDelayMs = opts.discv5FirstQueryDelayMs;
    this.connectToDiscv5BootnodesOnStart = opts.connectToDiscv5Bootnodes;

    this.libp2p.addEventListener("peer:discovery", this.onDiscoveredPeer);
    this.discv5.on("discovered", this.onDiscoveredENR);

    const numBootEnrs = opts.discv5.bootEnrs.length;
    if (numBootEnrs === 0) {
      this.logger.error("PeerDiscovery: discv5 has no boot enr");
    } else {
      this.logger.verbose("PeerDiscovery: number of bootEnrs", {bootEnrs: numBootEnrs});
    }

    if (this.connectToDiscv5BootnodesOnStart) {
      // In devnet scenarios, especially, we want more control over which peers we connect to.
      // Only dial the discv5.bootEnrs if the option
      // network.connectToDiscv5Bootnodes has been set to true.
      for (const bootENR of opts.discv5.bootEnrs) {
        this.onDiscoveredENR(ENR.decodeTxt(bootENR)).catch((e) =>
          this.logger.error("error onDiscoveredENR bootENR", {}, e)
        );
      }
    }

    if (metrics) {
      metrics.discovery.cachedENRsSize.addCollect(() => {
        metrics.discovery.cachedENRsSize.set(this.cachedENRs.size);
        metrics.discovery.peersToConnect.set(this.peersToConnect);
        for (const type of [SubnetType.attnets, SubnetType.syncnets]) {
          const subnetPeersToConnect = Array.from(this.subnetRequests[type].values()).reduce(
            (acc, {peersToConnect}) => acc + peersToConnect,
            0
          );
          metrics.discovery.subnetPeersToConnect.set({type}, subnetPeersToConnect);
          metrics.discovery.subnetsToConnect.set({type}, this.subnetRequests[type].size);
        }
      });
    }
  }

  static async init(modules: PeerDiscoveryModules, opts: PeerDiscoveryOpts): Promise<PeerDiscovery> {
    const discv5 = await Discv5Worker.init({
      discv5: opts.discv5,
      peerId: modules.libp2p.peerId,
      metrics: modules.metrics ?? undefined,
      logger: modules.logger,
      config: modules.config,
    });

    return new PeerDiscovery(modules, opts, discv5);
  }

  async stop(): Promise<void> {
    this.libp2p.removeEventListener("peer:discovery", this.onDiscoveredPeer);
    this.discv5.off("discovered", this.onDiscoveredENR);
    await this.discv5.close();
  }

  /**
   * Request to find peers, both on specific subnets and in general
   */
  discoverPeers(peersToConnect: number, subnetRequests: SubnetDiscvQueryMs[] = []): void {
    const subnetsToDiscoverPeers: SubnetDiscvQueryMs[] = [];
    const cachedENRsToDial = new Map<PeerIdStr, CachedENR>();
    // Iterate in reverse to consider first the most recent ENRs
    const cachedENRsReverse: CachedENR[] = [];
    const pendingDials = new Set(
      this.libp2p.services.components.connectionManager
        .getDialQueue()
        .map((pendingDial) => pendingDial.peerId?.toString())
    );
    for (const [id, cachedENR] of this.cachedENRs.entries()) {
      if (
        // time expired or
        Date.now() - cachedENR.addedUnixMs > MAX_CACHED_ENR_AGE_MS ||
        // already dialing
        pendingDials.has(id)
      ) {
        this.cachedENRs.delete(id);
      } else {
        cachedENRsReverse.push(cachedENR);
      }
    }
    cachedENRsReverse.reverse();

    this.peersToConnect += peersToConnect;

    subnet: for (const subnetRequest of subnetRequests) {
      // Get cached ENRs from the discovery service that are in the requested `subnetId`, but not connected yet
      let cachedENRsInSubnet = 0;
      for (const cachedENR of cachedENRsReverse) {
        if (cachedENR.subnets[subnetRequest.type][subnetRequest.subnet]) {
          cachedENRsToDial.set(cachedENR.peerId.toString(), cachedENR);

          if (++cachedENRsInSubnet >= subnetRequest.maxPeersToDiscover) {
            continue subnet;
          }
        }
      }

      const subnetPeersToConnect = Math.max(subnetRequest.maxPeersToDiscover - cachedENRsInSubnet, 0);

      // Extend the toUnixMs for this subnet
      const prevUnixMs = this.subnetRequests[subnetRequest.type].get(subnetRequest.subnet)?.toUnixMs;
      const newUnixMs =
        prevUnixMs !== undefined && prevUnixMs > subnetRequest.toUnixMs ? prevUnixMs : subnetRequest.toUnixMs;
      this.subnetRequests[subnetRequest.type].set(subnetRequest.subnet, {
        toUnixMs: newUnixMs,
        peersToConnect: subnetPeersToConnect,
      });

      // Query a discv5 query if more peers are needed
      subnetsToDiscoverPeers.push(subnetRequest);
    }

    // If subnetRequests won't connect enough peers for peersToConnect, add more
    if (cachedENRsToDial.size < peersToConnect) {
      for (const cachedENR of cachedENRsReverse) {
        cachedENRsToDial.set(cachedENR.peerId.toString(), cachedENR);
        if (cachedENRsToDial.size >= peersToConnect) {
          break;
        }
      }
    }

    // Queue an outgoing connection request to the cached peers that are on `s.subnet_id`.
    // If we connect to the cached peers before the discovery query starts, then we potentially
    // save a costly discovery query.
    for (const [id, cachedENRToDial] of cachedENRsToDial) {
      this.cachedENRs.delete(id);
      void this.dialPeer(cachedENRToDial);
    }

    // Run a discv5 subnet query to try to discover new peers
    const shouldRunFindRandomNodeQuery = subnetsToDiscoverPeers.length > 0 || cachedENRsToDial.size < peersToConnect;
    if (shouldRunFindRandomNodeQuery) {
      void this.runFindRandomNodeQuery();
    }

    this.logger.debug("Discover peers outcome", {
      peersToConnect,
      peersAvailableToDial: cachedENRsToDial.size,
      subnetsToDiscover: subnetsToDiscoverPeers.length,
      shouldRunFindRandomNodeQuery,
    });
  }

  /**
   * Request discv5 to find peers if there is no query in progress
   */
  private async runFindRandomNodeQuery(): Promise<void> {
    // Delay the 1st query after starting discv5
    // See https://github.com/ChainSafe/lodestar/issues/3423
    const msSinceDiscv5Start = Date.now() - this.discv5StartMs;
    if (msSinceDiscv5Start <= this.discv5FirstQueryDelayMs) {
      await sleep(this.discv5FirstQueryDelayMs - msSinceDiscv5Start);
    }

    // Run a general discv5 query if one is not already in progress
    if (this.randomNodeQuery.code === QueryStatusCode.Active) {
      this.metrics?.discovery.findNodeQueryRequests.inc({action: "ignore"});
      return;
    } else {
      this.metrics?.discovery.findNodeQueryRequests.inc({action: "start"});
    }

    // Use async version to prevent blocking the event loop
    // Time to completion of this function is not critical, in case this async call add extra lag
    this.randomNodeQuery = {code: QueryStatusCode.Active, count: 0};
    const timer = this.metrics?.discovery.findNodeQueryTime.startTimer();

    try {
      const enrs = await this.discv5.findRandomNode();
      this.metrics?.discovery.findNodeQueryEnrCount.inc(enrs.length);
    } catch (e) {
      this.logger.error("Error on discv5.findNode()", {}, e as Error);
    } finally {
      this.randomNodeQuery = {code: QueryStatusCode.NotActive};
      timer?.();
    }
  }

  /**
   * Progressively called by libp2p as a result of peer discovery or updates to its peer store
   */
  private onDiscoveredPeer = (evt: CustomEvent<PeerInfo>): void => {
    const {id, multiaddrs} = evt.detail;

    // libp2p may send us PeerInfos without multiaddrs https://github.com/libp2p/js-libp2p/issues/1873
    if (!multiaddrs || multiaddrs.length === 0) {
      this.metrics?.discovery.discoveredStatus.inc({status: DiscoveredPeerStatus.no_multiaddrs});
      return;
    }

    const attnets = zeroAttnets;
    const syncnets = zeroSyncnets;
    const status = this.handleDiscoveredPeer(id, multiaddrs[0], attnets, syncnets);
    this.logger.debug("Discovered peer via libp2p", {peer: prettyPrintPeerId(id), status});
    this.metrics?.discovery.discoveredStatus.inc({status});
  };

  /**
   * Progressively called by discv5 as a result of any query.
   */
  private onDiscoveredENR = async (enr: ENR): Promise<void> => {
    if (this.randomNodeQuery.code === QueryStatusCode.Active) {
      this.randomNodeQuery.count++;
    }
    // async due to some crypto that's no longer necessary
    const peerId = await enr.peerId();
    // tcp multiaddr is known to be be present, checked inside the worker
    const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
    if (!multiaddrTCP) {
      this.logger.error("Discv5 worker sent enr without tcp multiaddr", {enr: enr.encodeTxt()});
      this.metrics?.discovery.discoveredStatus.inc({status: DiscoveredPeerStatus.error});
      return;
    }
    // Are this fields mandatory?
    const attnetsBytes = enr.kvs.get(ENRKey.attnets); // 64 bits
    const syncnetsBytes = enr.kvs.get(ENRKey.syncnets); // 4 bits

    // Use faster version than ssz's implementation that leverages pre-cached.
    // Some nodes don't serialize the bitfields properly, encoding the syncnets as attnets,
    // which cause the ssz implementation to throw on validation. deserializeEnrSubnets() will
    // never throw and treat too long or too short bitfields as zero-ed
    const attnets = attnetsBytes ? deserializeEnrSubnets(attnetsBytes, ATTESTATION_SUBNET_COUNT) : zeroAttnets;
    const syncnets = syncnetsBytes ? deserializeEnrSubnets(syncnetsBytes, SYNC_COMMITTEE_SUBNET_COUNT) : zeroSyncnets;

    const status = this.handleDiscoveredPeer(peerId, multiaddrTCP, attnets, syncnets);
    this.logger.debug("Discovered peer via discv5", {peer: prettyPrintPeerId(peerId), status});
    this.metrics?.discovery.discoveredStatus.inc({status});
  };

  /**
   * Progressively called by peer discovery as a result of any query.
   */
  private handleDiscoveredPeer(
    peerId: PeerId,
    multiaddrTCP: Multiaddr,
    attnets: boolean[],
    syncnets: boolean[]
  ): DiscoveredPeerStatus {
    try {
      // Check if peer is not banned or disconnected
      if (this.peerRpcScores.getScoreState(peerId) !== ScoreState.Healthy) {
        return DiscoveredPeerStatus.bad_score;
      }

      // Ignore connected peers. TODO: Is this check necessary?
      if (this.isPeerConnected(peerId.toString())) {
        return DiscoveredPeerStatus.already_connected;
      }

      // Ignore dialing peers
      if (
        this.libp2p.services.components.connectionManager
          .getDialQueue()
          .find((pendingDial) => pendingDial.peerId && pendingDial.peerId.equals(peerId))
      ) {
        return DiscoveredPeerStatus.already_dialing;
      }

      // Should dial peer?
      const cachedPeer: CachedENR = {
        peerId,
        multiaddrTCP,
        subnets: {attnets, syncnets},
        addedUnixMs: Date.now(),
      };

      // Only dial peer if necessary
      if (this.shouldDialPeer(cachedPeer)) {
        void this.dialPeer(cachedPeer);
        return DiscoveredPeerStatus.attempt_dial;
      } else {
        // Add to pending good peers with a last seen time
        this.cachedENRs.set(peerId.toString(), cachedPeer);
        const dropped = pruneSetToMax(this.cachedENRs, MAX_CACHED_ENRS);
        // If the cache was already full, count the peer as dropped
        return dropped > 0 ? DiscoveredPeerStatus.dropped : DiscoveredPeerStatus.cached;
      }
    } catch (e) {
      this.logger.error("Error onDiscovered", {}, e as Error);
      return DiscoveredPeerStatus.error;
    }
  }

  private shouldDialPeer(peer: CachedENR): boolean {
    for (const type of [SubnetType.attnets, SubnetType.syncnets]) {
      for (const [subnet, {toUnixMs, peersToConnect}] of this.subnetRequests[type].entries()) {
        if (toUnixMs < Date.now() || peersToConnect === 0) {
          // Prune all requests so that we don't have to loop again
          // if we have low subnet peers then PeerManager will update us again with subnet + toUnixMs + peersToConnect
          this.subnetRequests[type].delete(subnet);
        } else {
          // not expired and peersToConnect > 0
          // if we have enough subnet peers, no need to dial more or we may have performance issues
          // see https://github.com/ChainSafe/lodestar/issues/5741#issuecomment-1643113577
          if (peer.subnets[type][subnet]) {
            this.subnetRequests[type].set(subnet, {toUnixMs, peersToConnect: Math.max(peersToConnect - 1, 0)});
            return true;
          }
        }
      }
    }

    // ideally we may want to leave this cheap condition at the top of the function
    // however we want to also update peersToConnect in this.subnetRequests
    // the this.subnetRequests[type] gradually has 0 subnet so this function should be cheap enough
    if (this.peersToConnect > 0) {
      return true;
    }

    return false;
  }

  /**
   * Handles DiscoveryEvent::QueryResult
   * Peers that have been returned by discovery requests are dialed here if they are suitable.
   */
  private async dialPeer(cachedPeer: CachedENR): Promise<void> {
    // we dial a peer when:
    // - this.peersToConnect > 0
    // - or the peer subscribes to a subnet that we want
    // If this.peersToConnect is 3 while we need to dial 5 subnet peers, in that case we want this.peersToConnect
    // to be 0 instead of a negative value. The next heartbeat may increase this.peersToConnect again if some dials
    // are not successful.
    this.peersToConnect = Math.max(this.peersToConnect - 1, 0);

    const {peerId, multiaddrTCP} = cachedPeer;

    // Must add the multiaddrs array to the address book before dialing
    // https://github.com/libp2p/js-libp2p/blob/aec8e3d3bb1b245051b60c2a890550d262d5b062/src/index.js#L638
    await this.libp2p.peerStore.merge(peerId, {multiaddrs: [multiaddrTCP]});

    // Note: PeerDiscovery adds the multiaddrTCP beforehand
    const peerIdShort = prettyPrintPeerId(peerId);
    this.logger.debug("Dialing discovered peer", {peer: peerIdShort});

    this.metrics?.discovery.dialAttempts.inc();
    const timer = this.metrics?.discovery.dialTime.startTimer();

    // Note: `libp2p.dial()` is what libp2p.connectionManager autoDial calls
    // Note: You must listen to the connected events to listen for a successful conn upgrade
    try {
      await this.libp2p.dial(peerId);
      timer?.({status: "success"});
      this.logger.debug("Dialed discovered peer", {peer: peerIdShort});
    } catch (e) {
      timer?.({status: "error"});
      formatLibp2pDialError(e as Error);
      this.logger.debug("Error dialing discovered peer", {peer: peerIdShort}, e as Error);
    }
  }

  /** Check if there is 1+ open connection with this peer */
  private isPeerConnected(peerIdStr: PeerIdStr): boolean {
    const connections = getConnectionsMap(this.libp2p).get(peerIdStr);
    return Boolean(connections && connections.some((connection) => connection.status === "open"));
  }
}

/**
 * libp2p errors with extremely noisy errors here, which are deeply nested taking 30-50 lines.
 * Some known errors:
 * ```
 * Error: The operation was aborted
 * Error: stream ended before 1 bytes became available
 * Error: Error occurred during XX handshake: Error occurred while verifying signed payload: Peer ID doesn't match libp2p public key
 * ```
 *
 * Also the error's message is not properly formatted, where the error message is indented and includes the full stack
 * ```
 * {
 *  emessage: '\n' +
 *    '    Error: stream ended before 1 bytes became available\n' +
 *    '        at /home/lion/Code/eth2.0/lodestar/node_modules/it-reader/index.js:37:9\n' +
 *    '        at runMicrotasks (<anonymous>)\n' +
 *    '        at decoder (/home/lion/Code/eth2.0/lodestar/node_modules/it-length-prefixed/src/decode.js:113:22)\n' +
 *    '        at first (/home/lion/Code/eth2.0/lodestar/node_modules/it-first/index.js:11:20)\n' +
 *    '        at Object.exports.read (/home/lion/Code/eth2.0/lodestar/node_modules/multistream-select/src/multistream.js:31:15)\n' +
 *    '        at module.exports (/home/lion/Code/eth2.0/lodestar/node_modules/multistream-select/src/select.js:21:19)\n' +
 *    '        at Upgrader._encryptOutbound (/home/lion/Code/eth2.0/lodestar/node_modules/libp2p/src/upgrader.js:397:36)\n' +
 *    '        at Upgrader.upgradeOutbound (/home/lion/Code/eth2.0/lodestar/node_modules/libp2p/src/upgrader.js:176:11)\n' +
 *    '        at ClassIsWrapper.dial (/home/lion/Code/eth2.0/lodestar/node_modules/libp2p-tcp/src/index.js:49:18)'
 * }
 * ```
 *
 * Tracking issue https://github.com/libp2p/js-libp2p/issues/996
 */
function formatLibp2pDialError(e: Error): void {
  const errorMessage = e.message.trim();
  const newlineIndex = errorMessage.indexOf("\n");
  e.message = newlineIndex !== -1 ? errorMessage.slice(0, newlineIndex) : errorMessage;

  if (
    e.message.includes("The operation was aborted") ||
    e.message.includes("stream ended before 1 bytes became available") ||
    e.message.includes("The operation was aborted")
  ) {
    e.stack = undefined;
  }
}
