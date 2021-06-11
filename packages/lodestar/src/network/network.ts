/**
 * @module network
 */

import LibP2p, {Connection} from "libp2p";
import PeerId from "peer-id";
import Multiaddr from "multiaddr";
import {AbortSignal} from "abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../metrics";
import {ReqResp, IReqResp, IReqRespOptions} from "./reqresp";
import {INetworkOptions} from "./options";
import {INetwork} from "./interface";
import {IBeaconChain, IBeaconClock} from "../chain";
import {MetadataController} from "./metadata";
import {Discv5Discovery, ENR} from "@chainsafe/discv5";
import {IPeerMetadataStore, Libp2pPeerMetadataStore} from "./peers/metastore";
import {PeerManager} from "./peers/peerManager";
import {IPeerRpcScoreStore, PeerRpcScoreStore} from "./peers";
import {IBeaconDb} from "../db";
import {createTopicValidatorFnMap, Eth2Gossipsub} from "./gossip";
import {IReqRespHandler} from "./reqresp/handlers";
import {INetworkEventBus, NetworkEventBus} from "./events";
import {AttnetsService, SyncnetsService, CommitteeSubscription} from "./subnets";
import {GossipHandler} from "./gossip/handler";

interface INetworkModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
  metrics: IMetrics | null;
  chain: IBeaconChain;
  db: IBeaconDb;
  reqRespHandler: IReqRespHandler;
  signal: AbortSignal;
}

export class Network implements INetwork {
  events: INetworkEventBus;
  reqResp: IReqResp;
  attnetsService: AttnetsService;
  syncnetsService: SyncnetsService;
  gossip: Eth2Gossipsub;
  metadata: MetadataController;
  peerMetadata: IPeerMetadataStore;
  peerRpcScores: IPeerRpcScoreStore;

  private readonly gossipHandler: GossipHandler;
  private readonly peerManager: PeerManager;
  private readonly libp2p: LibP2p;
  private readonly logger: ILogger;
  private readonly config: IBeaconConfig;
  private readonly clock: IBeaconClock;

  constructor(opts: INetworkOptions & IReqRespOptions, modules: INetworkModules) {
    const {config, libp2p, logger, metrics, chain, db, reqRespHandler, signal} = modules;
    this.libp2p = libp2p;
    this.logger = logger;
    this.config = config;
    this.clock = chain.clock;
    const networkEventBus = new NetworkEventBus();
    const metadata = new MetadataController({}, {config, chain, logger});
    const peerMetadata = new Libp2pPeerMetadataStore(config, libp2p.peerStore.metadataBook);
    const peerRpcScores = new PeerRpcScoreStore(peerMetadata);
    this.events = networkEventBus;
    this.metadata = metadata;
    this.peerRpcScores = peerRpcScores;
    this.peerMetadata = peerMetadata;
    this.reqResp = new ReqResp(
      {
        config,
        libp2p,
        forkDigestContext: chain.forkDigestContext,
        reqRespHandler,
        peerMetadata,
        metadata,
        peerRpcScores,
        logger,
        networkEventBus,
      },
      opts
    );
    this.gossip = new Eth2Gossipsub({
      config,
      libp2p,
      validatorFns: createTopicValidatorFnMap({config, chain, db, logger, metrics}, metrics, signal),
      logger,
      forkDigestContext: chain.forkDigestContext,
      metrics,
    });

    this.attnetsService = new AttnetsService(config, chain, this.gossip, metadata, logger);
    this.syncnetsService = new SyncnetsService(config, chain, this.gossip, metadata, logger);
    this.peerManager = new PeerManager(
      {
        libp2p,
        reqResp: this.reqResp,
        attnetsService: this.attnetsService,
        syncnetsService: this.syncnetsService,
        logger,
        metrics,
        chain,
        config,
        peerMetadata,
        peerRpcScores,
        networkEventBus,
      },
      opts
    );

    this.gossipHandler = new GossipHandler(config, chain, this.gossip, this.attnetsService, db, logger);
  }

  /** Destroy this instance. Can only be called once. */
  close(): void {
    this.gossipHandler.close();
  }

  async start(): Promise<void> {
    await this.libp2p.start();
    this.reqResp.start();
    this.metadata.start(this.getEnr(), this.config.getForkName(this.clock.currentSlot));
    this.peerManager.start();
    this.gossip.start();
    this.attnetsService.start();
    this.syncnetsService.start();
    const multiaddresses = this.libp2p.multiaddrs.map((m) => m.toString()).join(",");
    this.logger.info(`PeerId ${this.libp2p.peerId.toB58String()}, Multiaddrs ${multiaddresses}`);
  }

  async stop(): Promise<void> {
    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    this.gossipHandler.close();
    this.peerManager.stop();
    this.metadata.stop();
    this.gossip.stop();
    this.reqResp.stop();
    this.attnetsService.stop();
    this.syncnetsService.stop();
    this.gossip.stop();
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

  hasSomeConnectedPeer(): boolean {
    return this.peerManager.hasSomeConnectedPeer();
  }

  /**
   * Request att subnets up `toSlot`. Network will ensure to mantain some peers for each
   */
  prepareBeaconCommitteeSubnet(subscriptions: CommitteeSubscription[]): void {
    this.attnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  prepareSyncCommitteeSubnets(subscriptions: CommitteeSubscription[]): void {
    this.syncnetsService.addCommitteeSubscriptions(subscriptions);
    if (subscriptions.length > 0) this.peerManager.onCommitteeSubscriptions();
  }

  /**
   * The app layer needs to refresh the status of some peers. The sync have reached a target
   */
  reStatusPeers(peers: PeerId[]): void {
    this.peerManager.reStatusPeers(peers);
  }

  subscribeGossipCoreTopics(): void {
    this.gossipHandler.subscribeCoreTopics();
  }

  unsubscribeGossipCoreTopics(): void {
    this.gossipHandler.unsubscribeCoreTopics();
  }

  isSubscribedToGossipCoreTopics(): boolean {
    return this.gossipHandler.isSubscribedToCoreTopics;
  }

  // Debug

  async connectToPeer(peer: PeerId, multiaddr: Multiaddr[]): Promise<void> {
    this.libp2p.peerStore.addressBook.add(peer, multiaddr);
    await this.libp2p.dial(peer);
  }

  async disconnectPeer(peer: PeerId): Promise<void> {
    await this.libp2p.hangUp(peer);
  }
}
