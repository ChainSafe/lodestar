/**
 * @module network
 */

import LibP2p, {Connection} from "libp2p";
import PeerId from "peer-id";
import Multiaddr from "multiaddr";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconMetrics} from "../metrics";
import {ReqResp, IReqResp, IReqRespOptions} from "./reqresp";
import {INetworkOptions} from "./options";
import {INetwork} from "./interface";
import {IBeaconChain} from "../chain";
import {MetadataController} from "./metadata";
import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {RequestedSubnet} from "./peers";
import {IPeerMetadataStore, Libp2pPeerMetadataStore} from "./peers/metastore";
import {PeerManager} from "./peers/peerManager";
import {IPeerRpcScoreStore, PeerRpcScoreStore} from "./peers";
import {IBeaconDb} from "../db";
import {createTopicValidatorFnMap, Eth2Gossipsub} from "./gossip";
import {IReqRespHandler} from "./reqresp/handlers";
import {INetworkEventBus, NetworkEventBus} from "./events";
import {AbortSignal} from "abort-controller";

interface INetworkModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  metrics?: IBeaconMetrics;
  chain: IBeaconChain;
  db: IBeaconDb;
  reqRespHandler: IReqRespHandler;
  signal: AbortSignal;
}

export class Network implements INetwork {
  events: INetworkEventBus;
  reqResp: IReqResp;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
  peerMetadata: IPeerMetadataStore;
  peerRpcScores: IPeerRpcScoreStore;

  private peerManager: PeerManager;
  private libp2p: LibP2p;
  private logger: ILogger;

  constructor(opts: INetworkOptions & IReqRespOptions, modules: INetworkModules) {
    const {config, libp2p, logger, metrics, chain, db, reqRespHandler, signal} = modules;
    this.logger = logger;
    this.libp2p = libp2p;
    const networkEventBus = new NetworkEventBus();
    const metadata = new MetadataController({}, {config, chain, logger});
    const peerMetadata = new Libp2pPeerMetadataStore(config, libp2p.peerStore.metadataBook);
    const peerRpcScores = new PeerRpcScoreStore(peerMetadata);
    this.events = networkEventBus;
    this.metadata = metadata;
    this.peerRpcScores = peerRpcScores;
    this.peerMetadata = peerMetadata;
    this.reqResp = new ReqResp(
      {config, libp2p, reqRespHandler, peerMetadata, metadata, peerRpcScores, logger, networkEventBus},
      opts
    );
    this.gossip = new Eth2Gossipsub({
      config,
      genesisValidatorsRoot: chain.genesisValidatorsRoot,
      libp2p,
      validatorFns: createTopicValidatorFnMap({config, chain, db, logger}, metrics, signal),
      logger,
      metrics,
    });

    this.peerManager = new PeerManager(
      {libp2p, reqResp: this.reqResp, logger, metrics, chain, config, peerMetadata, peerRpcScores, networkEventBus},
      opts
    );
  }

  async start(): Promise<void> {
    await this.libp2p.start();
    this.reqResp.start();
    this.metadata.start(this.getEnr()!);
    this.peerManager.start();
    this.gossip.start();
    const multiaddresses = this.libp2p.multiaddrs.map((m) => m.toString()).join(",");
    this.logger.info(`PeerId ${this.libp2p.peerId.toB58String()}, Multiaddrs ${multiaddresses}`);
  }

  async stop(): Promise<void> {
    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    this.peerManager.stop();
    this.metadata.stop();
    this.gossip.stop();
    this.reqResp.stop();
    await this.libp2p.stop();
  }

  get localMultiaddrs(): Multiaddr[] {
    return this.libp2p.multiaddrs;
  }

  get peerId(): PeerId {
    return this.libp2p.peerId;
  }

  getEnr(): ENR | undefined {
    const discv5Discovery = this.libp2p._discovery.get("discv5") as Discv5Discovery;
    return discv5Discovery?.discv5?.enr ?? undefined;
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    return this.libp2p.connectionManager.connections;
  }

  getConnectedPeers(): PeerId[] {
    return this.peerManager.getConnectedPeerIds();
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  requestAttSubnets(requestedSubnets: RequestedSubnet[]): void {
    this.peerManager.requestAttSubnets(requestedSubnets);
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  reStatusPeers(peers: PeerId[]): void {
    this.peerManager.reStatusPeers(peers);
  }
}
