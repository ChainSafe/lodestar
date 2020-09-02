/**
 * @module network
 */

import {EventEmitter} from "events";
import LibP2p from "libp2p";
import PeerId from "peer-id";
import Multiaddr from "multiaddr";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconMetrics} from "../metrics";
import {ReqResp} from "./reqResp";
import {INetworkOptions} from "./options";
import {INetwork, NetworkEventEmitter, PeerSearchOptions} from "./interface";
import {Gossip} from "./gossip/gossip";
import {IGossip, IGossipMessageValidator} from "./gossip/interface";
import {IBeaconChain} from "../chain";
import {MetadataController} from "./metadata";
import {Discv5, Discv5Discovery, ENR} from "@chainsafe/discv5";
import {DiversifyPeersBySubnetTask} from "./tasks/diversifyPeersBySubnetTask";
import {CheckPeerAliveTask} from "./tasks/checkPeerAliveTask";
import {IPeerMetadataStore} from "./peers/interface";
import {Libp2pPeerMetadataStore} from "./peers/metastore";
import {getPeersWithSubnet} from "./peers/utils";

interface ILibp2pModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  metrics: IBeaconMetrics;
  validator: IGossipMessageValidator;
  chain: IBeaconChain;
}

export class Libp2pNetwork extends (EventEmitter as {new (): NetworkEventEmitter}) implements INetwork {
  public peerId: PeerId;
  public localMultiaddrs!: Multiaddr[];
  public reqResp: ReqResp;
  public gossip: IGossip;
  public metadata: MetadataController;
  public peerMetadata: IPeerMetadataStore;

  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private metrics: IBeaconMetrics;
  private diversifyPeersTask: DiversifyPeersBySubnetTask;
  private checkPeerAliveTask: CheckPeerAliveTask;

  public constructor(opts: INetworkOptions, {config, libp2p, logger, metrics, validator, chain}: ILibp2pModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.peerId = libp2p.peerId;
    this.libp2p = libp2p;
    this.peerMetadata = new Libp2pPeerMetadataStore(this.config, this.libp2p.peerStore.metadataBook);
    this.reqResp = new ReqResp(opts, {config, libp2p, peerMetadata: this.peerMetadata, logger});
    this.metadata = new MetadataController({}, {config, chain, logger});
    this.gossip = (new Gossip(opts, {config, libp2p, logger, validator, chain}) as unknown) as IGossip;
    this.diversifyPeersTask = new DiversifyPeersBySubnetTask(this.config, {
      network: this,
      logger: this.logger,
    });
    this.checkPeerAliveTask = new CheckPeerAliveTask(this.config, {
      network: this,
      logger: this.logger,
    });
  }

  public async start(): Promise<void> {
    this.libp2p.connectionManager.on("peer:connect", this.emitPeerConnect);
    this.libp2p.connectionManager.on("peer:disconnect", this.emitPeerDisconnect);
    await this.libp2p.start();
    this.localMultiaddrs = this.libp2p.multiaddrs;
    await this.reqResp.start();
    const enr = this.getEnr();
    await this.metadata.start(enr!);
    const multiaddresses = this.libp2p.multiaddrs.map((m) => m.toString()).join(",");
    this.logger.important(`PeerId ${this.libp2p.peerId.toB58String()}, Multiaddrs ${multiaddresses}`);
  }

  public async stop(): Promise<void> {
    this.libp2p.connectionManager.removeListener("peer:connect", this.emitPeerConnect);
    this.libp2p.connectionManager.removeListener("peer:disconnect", this.emitPeerDisconnect);
    await this.metadata.stop();
    await this.gossip.stop();
    await this.reqResp.stop();
    await this.libp2p.stop();
    await Promise.all([this.diversifyPeersTask.stop(), this.checkPeerAliveTask.stop()]);
  }

  public async handleSyncCompleted(): Promise<void> {
    await Promise.all([this.diversifyPeersTask.start(), this.checkPeerAliveTask.start()]);
  }

  public getEnr(): ENR | undefined {
    const discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    return discv5Discovery?.discv5?.enr ?? undefined;
  }

  public getPeers(opts: Partial<PeerSearchOptions> = {}): LibP2p.Peer[] {
    const peers = Array.from(this.libp2p.peerStore.peers.values()).filter((peer) => {
      if (opts?.connected && !this.getPeerConnection(peer.id)) {
        return false;
      }
      this.logger.debug("Peer supported protocols", {
        id: peer.id.toB58String(),
        protocols: peer.protocols,
      });
      if (opts?.supportsProtocols) {
        for (const protocol of opts.supportsProtocols) {
          if (!peer.protocols.includes(protocol)) {
            return false;
          }
        }
      }
      return true;
    });
    return peers || [];
  }

  public getMaxPeer(): number {
    return this.opts.maxPeers;
  }

  public hasPeer(peerId: PeerId, connected = false): boolean {
    const peer = this.libp2p.peerStore.get(peerId);
    if (!peer) {
      return false;
    }
    if (connected) {
      const conn = this.getPeerConnection(peerId);
      if (!conn || conn.stat.status !== "open") {
        return false;
      }
    }
    return true;
  }

  public getPeerConnection(peerId: PeerId): LibP2pConnection | null {
    return this.libp2p.connectionManager.get(peerId);
  }

  public async connect(peerId: PeerId, localMultiaddrs?: Multiaddr[]): Promise<void> {
    if (localMultiaddrs) {
      this.libp2p.peerStore.addressBook.add(peerId, localMultiaddrs);
    }
    await this.libp2p.dial(peerId);
  }

  public async disconnect(peerId: PeerId): Promise<void> {
    try {
      await this.libp2p.hangUp(peerId);
    } catch (e) {
      this.logger.warn("Unclean disconnect", {reason: e.message});
    }
  }

  public async searchSubnetPeers(subnet: string): Promise<void> {
    const peerIds = getPeersWithSubnet(
      this.getPeers({connected: true}).map((peer) => peer.id),
      this.peerMetadata,
      subnet
    );
    if (peerIds.length === 0) {
      // the validator must discover new peers on this topic
      this.logger.verbose(`Finding new peers for subnet ${subnet}`);
      const found = await this.connectToNewPeersBySubnet(parseInt(subnet));
      if (found) {
        this.logger.verbose(`Found new peer for subnet ${subnet}`);
      } else {
        this.logger.verbose(`Not found any peers for subnet ${subnet}`);
      }
    }
  }

  /**
   * Connect to 1 new peer given a subnet.
   * @param subnet the subnet calculated from committee index
   */
  private async connectToNewPeersBySubnet(subnet: number): Promise<boolean> {
    const discv5Peers = (await this.searchDiscv5Peers(subnet)) || [];
    const knownPeers = Array.from(await this.libp2p.peerStore.peers.values()).map((peer) => peer.id.toB58String());
    const candidatePeers = discv5Peers.filter((peer) => !knownPeers.includes(peer.peerId.toB58String()));
    let found = false;
    for (const peer of candidatePeers) {
      // will automatically get metadata once we connect
      try {
        await this.connect(peer.peerId, [peer.multiaddr]);
        found = true;
        break;
      } catch (e) {
        // this runs too frequently so make it verbose
        this.logger.verbose(`Cannot connect to peer ${peer.peerId.toB58String()} for subnet ${subnet}`, e.message);
      }
    }
    return found;
  }

  private searchDiscv5Peers = async (subnet: number): Promise<{peerId: PeerId; multiaddr: Multiaddr}[]> => {
    const discovery: Discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    const discv5: Discv5 = discovery.discv5;
    return await Promise.all(
      discv5
        .kadValues()
        .filter((enr: ENR) => enr.get("attnets"))
        .filter((enr: ENR) => {
          try {
            return this.config.types.AttestationSubnets.deserialize(enr.get("attnets")!)[subnet];
          } catch (err) {
            return false;
          }
        })
        .map((enr: ENR) =>
          enr.peerId().then((peerId) => {
            return {peerId, multiaddr: enr.multiaddrTCP!};
          })
        )
    );
  };

  private emitPeerConnect = (conn: LibP2pConnection): void => {
    this.metrics.peers.inc();
    this.logger.verbose("peer connected " + conn.remotePeer.toB58String() + " " + conn.stat.direction);
    //tmp fix, we will just do double status exchange but nothing major
    this.emit("peer:connect", conn.remotePeer, conn.stat.direction);
  };

  private emitPeerDisconnect = (conn: LibP2pConnection): void => {
    this.logger.verbose("peer disconnected " + conn.remotePeer.toB58String());
    this.metrics.peers.dec();
    this.emit("peer:disconnect", conn.remotePeer);
  };
}
