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
import {INetwork, NetworkEventEmitter,} from "./interface";
import {Gossip} from "./gossip/gossip";
import {IGossip, IGossipMessageValidator} from "./gossip/interface";
import {IBeaconChain} from "../chain";
import {MetadataController} from "./metadata";
import {Discv5, Discv5Discovery, ENR} from "@chainsafe/discv5";
import {IReputationStore} from "../sync/IReputation";

interface ILibp2pModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  metrics: IBeaconMetrics;
  validator: IGossipMessageValidator;
  chain: IBeaconChain;
}


export class Libp2pNetwork extends (EventEmitter as { new(): NetworkEventEmitter }) implements INetwork {

  public peerId: PeerId;
  public multiaddrs: Multiaddr[];
  public reqResp: ReqResp;
  public gossip: IGossip;
  public metadata: MetadataController;

  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private logger: ILogger;
  private metrics: IBeaconMetrics;
  private peerReputations: IReputationStore;

  public constructor(opts: INetworkOptions,
    reps: IReputationStore, {config, libp2p, logger, metrics, validator, chain}: ILibp2pModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.logger = logger;
    this.metrics = metrics;
    this.peerReputations = reps;
    this.peerId = libp2p.peerId;
    this.libp2p = libp2p;
    this.reqResp = new ReqResp(opts, {config, libp2p, peerReputations: this.peerReputations, logger});
    this.metadata = new MetadataController({}, {config, chain, logger});
    this.gossip = (new Gossip(opts, {config, libp2p, logger, validator, chain})) as unknown as IGossip;
  }

  public async start(): Promise<void> {
    await this.libp2p.start();
    this.multiaddrs = this.libp2p.multiaddrs;
    await this.reqResp.start();
    const enr = this.getEnr();
    await this.metadata.start(enr);
    this.libp2p.connectionManager.on("peer:connect", this.emitPeerConnect);
    this.libp2p.connectionManager.on("peer:disconnect", this.emitPeerDisconnect);
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
  }


  public getEnr(): ENR|undefined {
    const discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    return discv5Discovery?.discv5?.enr || undefined;
  }

  public getPeers(): PeerId[] {
    const peers =  Array.from(this.libp2p.peerStore.peers.values())
      .map(peerInfo => peerInfo.id)
      .filter(peerId => !!this.getPeerConnection(peerId));
    return peers || [];
  }

  public hasPeer(peerId: PeerId): boolean {
    return !!this.getPeerConnection(peerId);
  }

  public getPeerConnection(peerId: PeerId): LibP2pConnection|null {
    return this.libp2p.connectionManager.get(peerId);
  }

  public async connect(peerId: PeerId, multiaddrs?: Multiaddr[]): Promise<void> {
    if (multiaddrs) {
      this.libp2p.peerStore.addressBook.add(peerId, multiaddrs);
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

  public async  searchSubnetPeers(subnet: string): Promise<void> {
    const peerIds = this.peerReputations.getPeerIdsBySubnet(subnet);
    if (peerIds.length < 3) {
      // If an insufficient number of current peers are subscribed to the topic,
      // the validator must discover new peers on this topic
      this.logger.verbose(`Found only ${peerIds.length} for subnett ${subnet}, finding new peers to connect`);
      const count = await this.connectToNewPeersBySubnet(parseInt(subnet), peerIds);
      this.logger.verbose(`Connected to ${count} new peers for subnet ${subnet}`);
    }
  }

  /**
   * Connect to new peers given a subnet.
   * @param subnet the subnet calculated from committee index
   * @param inPeerIds peers already have this subnet
   */
  private async connectToNewPeersBySubnet(subnet: number, inPeerIds: string[] = []): Promise<number> {
    const discv5Peers = await this.searchDiscv5Peers(subnet) || [];
    const peerIds = discv5Peers.filter(peerId => !inPeerIds.includes(peerId.toB58String()));
    // make sure they still connect to same subnet
    let count = 0;
    for (const peerId of peerIds) {
      // we'll dial thru sendRequest so don't need to do connect() like in the spec
      try {
        const metadata = await this.reqResp.metadata(peerId);
        if (metadata.attnets[subnet]) {
          count++;
        }
      } catch (err) {
        this.logger.warn(`Cannot get metadata from ${peerId.toB58String()}`);
      }
      if (count < 10) {
        // TODO: decide max peers per subnet to connect?
        break;
      }
    }
    return count;
  }

  private searchDiscv5Peers = async (subnet: number): Promise<PeerId[]> => {
    const discovery: Discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    const discv5: Discv5 = discovery.discv5;
    return await Promise.all(
      discv5.kadValues()
        .filter((enr: ENR) => enr.get("attnets"))
        .filter((enr: ENR) => {
          try {
            return this.config.types.AttestationSubnets.deserialize(enr.get("attnets"))[subnet];
          } catch (err) {
            return false;
          }
        })
        .map((enr: ENR) => enr.peerId().then((peerId) => {
          this.libp2p.peerStore.addressBook.add(peerId, [enr.multiaddrTCP]);
          return peerId;
        })));
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
