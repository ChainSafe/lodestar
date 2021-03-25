import LibP2p from "libp2p";
import PeerId from "peer-id";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {Discv5, Discv5Discovery} from "@chainsafe/discv5";
import {shuffle} from "../../util/shuffle";
import {getConnectedPeerIds} from "./utils";
import {IPeerRpcScoreStore, ScoreState} from "./score";

export type AttSubnetQuery = {subnetId: number; maxPeersToDiscover: number};

export type PeerDiscoveryOpts = {
  maxPeers: number;
};

export type PeerDiscoveryModules = {
  libp2p: LibP2p;
  peerRpcScores: IPeerRpcScoreStore;
  logger: ILogger;
  config: IBeaconConfig;
};

type PeerIdStr = string;

/**
 * PeerDiscovery discovers and dials new peers, and executes discv5 queries.
 * Currently relies on discv5 automatic periodic queries
 */
export class PeerDiscovery {
  private libp2p: LibP2p;
  private peerRpcScores: IPeerRpcScoreStore;
  private logger: ILogger;
  private config: IBeaconConfig;

  /** The maximum number of peers we allow (exceptions for subnet peers) */
  private maxPeers: number;

  constructor(modules: PeerDiscoveryModules, opts: PeerDiscoveryOpts) {
    this.libp2p = modules.libp2p;
    this.peerRpcScores = modules.peerRpcScores;
    this.logger = modules.logger;
    this.config = modules.config;
    this.maxPeers = opts.maxPeers;
  }

  /**
   * Request to find peers. First, looked at cached peers in peerStore
   */
  discoverPeers(maxPeersToDiscover: number): void {
    // To remove self peer if present
    const ownPeerIdStr = this.libp2p.peerId.toB58String();
    const notConnectedPeers = this.getStoredPeerIdStr().filter(
      (peerIdStr) => !this.isPeerConnected(peerIdStr) && peerIdStr !== ownPeerIdStr
    );

    const discPeers = shuffle(notConnectedPeers).slice(0, maxPeersToDiscover);
    this.peersDiscovered(discPeers);

    // TODO: Run a general discv5 query
  }

  /**
   * Request to find peers on a given subnet.
   */
  async discoverSubnetPeers(subnetsToDiscover: AttSubnetQuery[]): Promise<void> {
    const subnetsToDiscoverFiltered: number[] = [];

    for (const {subnetId, maxPeersToDiscover} of subnetsToDiscover) {
      // TODO:
      // Queue an outgoing connection request to the cached peers that are on `s.subnet_id`.
      // If we connect to the cached peers before the discovery query starts, then we potentially
      // save a costly discovery query.

      // Get cached ENRs from the discovery service that are in the requested `subnetId`, but not connected yet
      const discPeersOnSubnet = await this.getCachedDiscoveryPeersOnSubnet(subnetId, maxPeersToDiscover);
      this.peersDiscovered(discPeersOnSubnet);

      // Query a discv5 query if more peers are needed
      if (maxPeersToDiscover - discPeersOnSubnet.length > 0) {
        subnetsToDiscoverFiltered.push(subnetId);
      }
    }

    // Run a discv5 subnet query to try to discover new peers
    if (subnetsToDiscoverFiltered.length > 0) {
      void this.runSubnetQuery(subnetsToDiscoverFiltered.map((subnetId) => subnetId));
    }
  }

  /**
   * List existing peers that declare being part of a target subnet
   */
  async getCachedDiscoveryPeersOnSubnet(subnet: number, maxPeersToDiscover: number): Promise<PeerIdStr[]> {
    const discovery: Discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    // if disablePeerDiscovery = true, libp2p will not have any "discv5" module
    if (!discovery) return [];
    const discv5: Discv5 = discovery.discv5;

    const peersOnSubnet: PeerIdStr[] = [];

    // TODO: Should kadValues() be shuffle'd?
    for (const enr of discv5.kadValues()) {
      if (peersOnSubnet.length >= maxPeersToDiscover) {
        break;
      }

      try {
        const attnets = enr.get("attnets");
        if (attnets && this.config.types.phase0.AttestationSubnets.deserialize(attnets)[subnet]) {
          // async because peerId runs some crypto lib
          const peerId = await enr.peerId();

          // Mimic the regular discv5 + js-libp2p
          // Must get the tcp multiaddr and add it the addressBook. Ignore peers without
          // https://github.com/ChainSafe/discv5/blob/671a9ac8ec59ba9ad6dcce566036ce4758fe50a7/src/libp2p/discv5.ts#L92
          const multiaddrTCP = enr.getLocationMultiaddr("tcp");
          if (multiaddrTCP) {
            // Must add the multiaddrs array to the address book before dialing
            // https://github.com/libp2p/js-libp2p/blob/aec8e3d3bb1b245051b60c2a890550d262d5b062/src/index.js#L638
            this.libp2p.peerStore.addressBook.add(peerId, [multiaddrTCP]);
            peersOnSubnet.push(peerId.toB58String());
          }
        }
      } catch (e) {
        this.logger.debug("Error deserializing ENR", {nodeId: enr.nodeId}, e);
      }
    }

    return peersOnSubnet;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async runSubnetQuery(subnets: number[]): Promise<void> {
    // TODO: Run a discv5 query for a specific set of queries
  }

  /**
   * Handles DiscoveryEvent::QueryResult
   * Peers that have been returned by discovery requests are dialed here if they are suitable.
   */
  private peersDiscovered(discoveredPeers: PeerIdStr[]): void {
    const connectedPeersCount = getConnectedPeerIds(this.libp2p).length;
    const toDialPeers: PeerId[] = [];

    for (const peerIdStr of discoveredPeers) {
      const peer = PeerId.createFromCID(peerIdStr);
      if (
        connectedPeersCount + toDialPeers.length < this.maxPeers &&
        !this.isPeerConnected(peerIdStr) &&
        // Ensure peer is not banner or disconnected. New peers are healthy by default
        this.peerRpcScores.getScoreState(peer) === ScoreState.Healthy
      ) {
        // we attempt a connection if this peer is a subnet peer or if the max peer count
        // is not yet filled (including dialing peers)
        toDialPeers.push(peer);
      }
    }

    for (const peer of toDialPeers) {
      // Note: PeerDiscovery adds the multiaddrTCP beforehand
      this.logger.debug("Dialing discovered peer", {peer: peer.toB58String()});

      // Note: `libp2p.dial()` is what libp2p.connectionManager autoDial calls
      // Note: You must listen to the connected events to listen for a successful conn upgrade
      this.libp2p.dial(peer).catch((e) => {
        this.logger.debug("Error dialing discovered peer", {peer: peer.toB58String()}, e);
      });
    }
  }

  /** Return stored peerIdStr, may return self peerIdStr */
  private getStoredPeerIdStr(): PeerIdStr[] {
    return Array.from(((this.libp2p.peerStore as unknown) as Libp2pPeerStore).addressBook.data.keys());
  }

  /** Check if there is 1+ open connection with this peer */
  private isPeerConnected(peerIdStr: PeerIdStr): boolean {
    const connections = this.libp2p.connectionManager.connections.get(peerIdStr);
    return Boolean(connections && connections.some((connection) => connection.stat.status === "open"));
  }
}

type Libp2pPeerStore = {
  addressBook: {data: Map<string, void>};
};
