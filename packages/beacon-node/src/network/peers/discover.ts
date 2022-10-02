import crypto from "node:crypto";
import {promisify} from "node:util";
import {Libp2p} from "libp2p";
import {PeerId} from "@libp2p/interface-peer-id";
import {multiaddr, Multiaddr} from "@multiformats/multiaddr";
import {IBeaconConfig} from "@lodestar/config";
import {ILogger, pruneSetToMax} from "@lodestar/utils";
import {Discv5, ENR, IDiscv5Metrics, IDiscv5DiscoveryInputOptions} from "@chainsafe/discv5";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@lodestar/params";
import {IMetrics} from "../../metrics/index.js";
import {ENRKey, SubnetType} from "../metadata.js";
import {getConnectionsMap, prettyPrintPeerId} from "../util.js";
import {IPeerRpcScoreStore, ScoreState} from "./score.js";
import {deserializeEnrSubnets, zeroAttnets, zeroSyncnets} from "./utils/enrSubnetsDeserialize.js";

/** Max number of cached ENRs after discovering a good peer */
const MAX_CACHED_ENRS = 100;
/** Max age a cached ENR will be considered for dial */
const MAX_CACHED_ENR_AGE_MS = 5 * 60 * 1000;

const randomBytesAsync = promisify(crypto.randomBytes);

export type PeerDiscoveryOpts = {
  maxPeers: number;
  discv5FirstQueryDelayMs: number;
  discv5: Omit<IDiscv5DiscoveryInputOptions, "metrics" | "searchInterval" | "enabled">;
  connectToDiscv5Bootnodes?: boolean;
};

export type PeerDiscoveryModules = {
  libp2p: Libp2p;
  peerRpcScores: IPeerRpcScoreStore;
  metrics: IMetrics | null;
  logger: ILogger;
  config: IBeaconConfig;
};

type PeerIdStr = string;

enum QueryStatusCode {
  NotActive,
  Active,
}
type QueryStatus = {code: QueryStatusCode.NotActive} | {code: QueryStatusCode.Active; count: number};

enum DiscoveredPeerStatus {
  no_tcp = "no_tcp",
  no_eth2 = "no_eth2",
  unknown_forkDigest = "unknown_forkDigest",
  bad_score = "bad_score",
  already_connected = "already_connected",
  error = "error",
  attempt_dial = "attempt_dial",
  cached = "cached",
  dropped = "dropped",
}

type UnixMs = number;
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
  readonly discv5: Discv5;
  private libp2p: Libp2p;
  private peerRpcScores: IPeerRpcScoreStore;
  private metrics: IMetrics | null;
  private logger: ILogger;
  private config: IBeaconConfig;
  private cachedENRs = new Set<CachedENR>();
  private randomNodeQuery: QueryStatus = {code: QueryStatusCode.NotActive};
  private peersToConnect = 0;
  private subnetRequests: Record<SubnetType, Map<number, UnixMs>> = {
    attnets: new Map(),
    syncnets: new Map([[10, Date.now() + 2 * 60 * 60 * 1000]]),
  };

  /** The maximum number of peers we allow (exceptions for subnet peers) */
  private maxPeers: number;
  private discv5StartMs: number;
  private discv5FirstQueryDelayMs: number;

  private connectToDiscv5BootnodesOnStart: boolean | undefined = false;

  constructor(modules: PeerDiscoveryModules, opts: PeerDiscoveryOpts) {
    const {libp2p, peerRpcScores, metrics, logger, config} = modules;
    this.libp2p = libp2p;
    this.peerRpcScores = peerRpcScores;
    this.metrics = metrics;
    this.logger = logger;
    this.config = config;
    this.maxPeers = opts.maxPeers;
    this.discv5StartMs = 0;
    this.discv5FirstQueryDelayMs = opts.discv5FirstQueryDelayMs;
    this.connectToDiscv5BootnodesOnStart = opts.connectToDiscv5Bootnodes;

    this.discv5 = Discv5.create({
      enr: opts.discv5.enr,
      peerId: modules.libp2p.peerId,
      multiaddr: multiaddr(opts.discv5.bindAddr),
      config: opts.discv5,
      // TODO: IDiscv5Metrics is not properly defined, should remove the collect() function
      metrics: (modules.metrics?.discv5 as unknown) as {
        [K in keyof IMetrics["discv5"]]: IDiscv5Metrics[keyof IDiscv5Metrics];
      },
    });
    opts.discv5.bootEnrs.forEach((bootEnr) => this.discv5.addEnr(bootEnr));

    if (metrics) {
      metrics.discovery.cachedENRsSize.addCollect(() => {
        metrics.discovery.cachedENRsSize.set(this.cachedENRs.size);
        metrics.discovery.peersToConnect.set(this.peersToConnect);
      });
    }
  }

  async start(): Promise<void> {
    await this.discv5.start();
    this.discv5StartMs = Date.now();
    this.discv5.on("discovered", this.onDiscovered);
    if (this.connectToDiscv5BootnodesOnStart) {
      // In devnet scenarios, especially, we want more control over which peers we connect to.
      // Only dial the discv5.bootEnrs if the option
      // network.connectToDiscv5Bootnodes has been set to true.
      this.discv5.kadValues().forEach((enr) => this.onDiscovered(enr));
    }
  }

  async stop(): Promise<void> {
    this.discv5.off("discovered", this.onDiscovered);
    await this.discv5.stop();
  }

  /**
   * Request to find peers, both on specific subnets and in general
   */
  discoverPeers(peersToConnect: number, subnetRequests: SubnetDiscvQueryMs[] = []): void {
    const subnetsToDiscoverPeers: SubnetDiscvQueryMs[] = [];
    const cachedENRsToDial = new Set<CachedENR>();
    // Iterate in reverse to consider first the most recent ENRs
    const cachedENRsReverse: CachedENR[] = [];
    for (const cachedENR of this.cachedENRs) {
      if (Date.now() - cachedENR.addedUnixMs > MAX_CACHED_ENR_AGE_MS) {
        this.cachedENRs.delete(cachedENR);
      } else {
        cachedENRsReverse.unshift(cachedENR);
      }
    }

    this.peersToConnect += peersToConnect;

    subnet: for (const subnetRequest of subnetRequests) {
      // Extend the toUnixMs for this subnet
      const prevUnixMs = this.subnetRequests[subnetRequest.type].get(subnetRequest.subnet);
      if (prevUnixMs === undefined || prevUnixMs < subnetRequest.toUnixMs) {
        this.subnetRequests[subnetRequest.type].set(subnetRequest.subnet, subnetRequest.toUnixMs);
      }

      // Get cached ENRs from the discovery service that are in the requested `subnetId`, but not connected yet
      let cachedENRsInSubnet = 0;
      for (const cachedENR of cachedENRsReverse) {
        if (cachedENR.subnets[subnetRequest.type][subnetRequest.subnet]) {
          cachedENRsToDial.add(cachedENR);

          if (++cachedENRsInSubnet >= subnetRequest.maxPeersToDiscover) {
            continue subnet;
          }
        }
      }

      // Query a discv5 query if more peers are needed
      subnetsToDiscoverPeers.push(subnetRequest);
    }

    // If subnetRequests won't connect enough peers for peersToConnect, add more
    if (cachedENRsToDial.size < peersToConnect) {
      for (const cachedENR of cachedENRsReverse) {
        cachedENRsToDial.add(cachedENR);
        if (cachedENRsToDial.size >= peersToConnect) {
          break;
        }
      }
    }

    // Queue an outgoing connection request to the cached peers that are on `s.subnet_id`.
    // If we connect to the cached peers before the discovery query starts, then we potentially
    // save a costly discovery query.
    for (const cachedENRToDial of cachedENRsToDial) {
      this.cachedENRs.delete(cachedENRToDial);
      void this.dialPeer(cachedENRToDial);
    }

    // Run a discv5 subnet query to try to discover new peers
    if (subnetsToDiscoverPeers.length > 0 || cachedENRsToDial.size < peersToConnect) {
      void this.runFindRandomNodeQuery();
    }
  }

  /**
   * Request to find peers. First, looked at cached peers in peerStore
   */
  private async runFindRandomNodeQuery(): Promise<void> {
    // Delay the 1st query after starting discv5
    // See https://github.com/ChainSafe/lodestar/issues/3423
    if (Date.now() - this.discv5StartMs <= this.discv5FirstQueryDelayMs) {
      return;
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
    const randomNodeId = await randomBytesAsync(64);
    this.randomNodeQuery = {code: QueryStatusCode.Active, count: 0};
    const timer = this.metrics?.discovery.findNodeQueryTime.startTimer();

    try {
      const enrs = await this.discv5.findNode(randomNodeId.toString("hex"));
      this.metrics?.discovery.findNodeQueryEnrCount.inc(enrs.length);
    } catch (e) {
      this.logger.error("Error on discv5.findNode()", {}, e as Error);
    } finally {
      this.randomNodeQuery = {code: QueryStatusCode.NotActive};
      timer?.();
    }
  }

  /**
   * Progressively called by discv5 as a result of any query.
   */
  private onDiscovered = async (enr: ENR): Promise<void> => {
    const status = await this.handleDiscoveredPeer(enr);
    this.metrics?.discovery.discoveredStatus.inc({status});
  };

  /**
   * Progressively called by discv5 as a result of any query.
   */
  private async handleDiscoveredPeer(enr: ENR): Promise<DiscoveredPeerStatus> {
    try {
      if (this.randomNodeQuery.code === QueryStatusCode.Active) {
        this.randomNodeQuery.count++;
      }

      // We are not interested in peers that don't advertise their tcp addr
      const multiaddrTCP = enr.getLocationMultiaddr(ENRKey.tcp);
      if (!multiaddrTCP) {
        return DiscoveredPeerStatus.no_tcp;
      }

      // Check if the ENR.eth2 field matches and is of interest
      const eth2 = enr.get(ENRKey.eth2);
      if (!eth2) {
        return DiscoveredPeerStatus.no_eth2;
      }

      // Fast de-serialization without SSZ
      const forkDigest = eth2.slice(0, 4);
      // Check if forkDigest matches any of our known forks.
      const forkName = this.config.forkDigest2ForkNameOption(forkDigest);
      if (!forkName) {
        return DiscoveredPeerStatus.unknown_forkDigest;
      }

      // TODO: Then check if the next fork info matches ours
      // const enrForkId = ssz.phase0.ENRForkID.deserialize(eth2);

      // async due to some crypto that's no longer necessary
      const peerId = await enr.peerId();

      // Check if peer is not banned or disconnected
      if (this.peerRpcScores.getScoreState(peerId) !== ScoreState.Healthy) {
        return DiscoveredPeerStatus.bad_score;
      }

      // Ignore connected peers. TODO: Is this check necessary?
      if (this.isPeerConnected(peerId.toString())) {
        return DiscoveredPeerStatus.already_connected;
      }

      // Are this fields mandatory?
      const attnetsBytes = enr.get(ENRKey.attnets); // 64 bits
      const syncnetsBytes = enr.get(ENRKey.syncnets); // 4 bits

      // Use faster version than ssz's implementation that leverages pre-cached.
      // Some nodes don't serialize the bitfields properly, encoding the syncnets as attnets,
      // which cause the ssz implementation to throw on validation. deserializeEnrSubnets() will
      // never throw and treat too long or too short bitfields as zero-ed
      const attnets = attnetsBytes ? deserializeEnrSubnets(attnetsBytes, ATTESTATION_SUBNET_COUNT) : zeroAttnets;
      const syncnets = syncnetsBytes ? deserializeEnrSubnets(syncnetsBytes, SYNC_COMMITTEE_SUBNET_COUNT) : zeroSyncnets;

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
        this.cachedENRs.add(cachedPeer);
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
    if (this.peersToConnect > 0) {
      return true;
    }

    for (const type of [SubnetType.attnets, SubnetType.syncnets]) {
      for (const [subnet, toUnixMs] of this.subnetRequests[type].entries()) {
        if (toUnixMs < Date.now()) {
          // Prune all requests
          this.subnetRequests[type].delete(subnet);
        } else {
          if (peer.subnets[type][subnet]) {
            return true;
          }
        }
      }
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
    await this.libp2p.peerStore.addressBook.add(peerId, [multiaddrTCP]);

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
    const connections = getConnectionsMap(this.libp2p.connectionManager).get(peerIdStr);
    return Boolean(connections && connections.some((connection) => connection.stat.status === "OPEN"));
  }
}

/**
 * libp2p errors with extremely noisy errors here, which are deeply nested taking 30-50 lines.
 * Some known erors:
 * ```
 * Error: The operation was aborted
 * Error: stream ended before 1 bytes became available
 * Error: Error occurred during XX handshake: Error occurred while verifying signed payload: Peer ID doesn't match libp2p public key
 * ```
 *
 * Also the error's message is not properly formated, where the error message in indentated and includes the full stack
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
  e.message = errorMessage.slice(0, errorMessage.indexOf("\n"));

  if (
    e.message.includes("The operation was aborted") ||
    e.message.includes("stream ended before 1 bytes became available") ||
    e.message.includes("The operation was aborted")
  ) {
    e.stack === undefined;
  }
}
