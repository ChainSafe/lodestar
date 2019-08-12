/**
 * @module network/hobbits
 */

import {EventEmitter} from "events";
import {INetwork} from "../interface";
import {HobbitsConnectionHandler} from "./hobbitsConnectionHandler";
import {ILogger} from "../../logger";
import {Attestation, BeaconBlock, RequestBody, ResponseBody, Shard} from "../../types";
import net from "net";
import PeerInfo from "peer-info";
import NodeAddress = Multiaddr.NodeAddress;
import {deserialize} from "@chainsafe/ssz";
import {ATTESTATION_TOPIC, BLOCK_TOPIC, Method, RequestId, SHARD_SUBNET_COUNT} from "../../constants";
import {shardAttestationTopic, shardSubnetAttestationTopic} from "../util";
import {HobbitsUri} from "./hobbitsUri";
import {INetworkOptions} from "../options";
import {IBeaconConfig} from "../../config";
import {Peer} from "./peer";
import {GossipTopic} from "./constants";

export  class HobbitsP2PNetwork extends EventEmitter implements INetwork {
  public peerInfo: PeerInfo;
  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private rpc: HobbitsConnectionHandler;
  private inited: Promise<void>;
  private logger: ILogger;
  public running: boolean;

  // subscriptions
  private subscriptions: Map<string, boolean>;

  public constructor(opts: INetworkOptions, {config, logger}: {config: IBeaconConfig;logger: ILogger}) {
    super();
    this.running = false;
    this.opts = opts;
    this.config = config;
    this.logger = logger;
    // `libp2p` can be a promise as well as a libp2p object
    this.inited = new Promise((resolve) => {
      this.rpc = new HobbitsConnectionHandler(opts,{config, logger});
      resolve();
    });
  }


  // pubsub
  public subscribeToBlocks(): void {
    this.subscriptions[BLOCK_TOPIC] = true;
  }
  public subscribeToAttestations(): void {
    this.subscriptions[ATTESTATION_TOPIC] = true;
  }
  public subscribeToShardAttestations(shard: Shard): void {
    this.subscriptions[shardSubnetAttestationTopic(shard)] = true;
  }
  public unsubscribeToBlocks(): void {
    this.subscriptions[BLOCK_TOPIC] = false;
  }
  public unsubscribeToAttestations(): void {
    this.subscriptions[ATTESTATION_TOPIC] = false;
  }
  public unsubscribeToShardAttestations(shard: Shard): void {
    this.subscriptions[shardSubnetAttestationTopic(shard)] = false;
  }

  // handle publishing of gossip messages
  public async publishBlock(block: BeaconBlock): Promise<void> {
    this.rpc.publishBlock(block);
  }
  public async publishAttestation(attestation: Attestation): Promise<void> {
    this.rpc.publishAttestation(attestation);
  }
  public async publishShardAttestation(attestation: Attestation): Promise<void> {
    this.rpc.publishShardAttestation(attestation);
  }

  private handleIncomingBlock(msg: any): void {
    // check subscription
    if(!this.subscriptions[BLOCK_TOPIC]){
      // drop
      return;
    }

    try {
      const block: BeaconBlock = deserialize(msg.requestBody, this.config.types.BeaconBlock);
      this.emit(BLOCK_TOPIC, block);
    } catch (e) {
    }
  }
  private handleIncomingAttestation(msg: any): void {
    // check subscription
    if(!this.subscriptions[ATTESTATION_TOPIC]){
      // drop
      return;
    }

    try {
      const attestation: Attestation = deserialize(msg.requestBody, this.config.types.Attestation);
      this.emit(ATTESTATION_TOPIC, attestation);
    } catch (e) {
    }
  }
  // this method won't be called
  private handleIncomingShardAttestation(msg: any): void {
    // try {
    //   const attestation: Attestation = deserialize(msg.data, this.config.types.Attestation);
    //   this.emit(shardAttestationTopic(attestation.data.crosslink.shard), attestation);
    // } catch (e) {
    // }
  }
  private emitGossipHeartbeat(): void {
    // this.emit("gossipsub:heartbeat");
  }

  // rpc
  public getPeers(): PeerInfo[] {
    return this.rpc.getPeers();
  }
  public hasPeer(peerInfo: PeerInfo): boolean {
    return this.rpc.hasPeer(peerInfo);
  }
  public async connect(peerInfo: PeerInfo): Promise<void> {
    await this.rpc.dialForRpc(peerInfo);
  }
  public async disconnect(peerInfo: PeerInfo): Promise<void> {
    await this.rpc.removePeer(peerInfo);
  }
  public async sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: number, body: RequestBody): Promise<T> {
    // the imported method is not correct
    return await this.rpc.sendRequest<T>(peerInfo, method, body);
  }
  public sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void {
    // convert id from string to uint64
    // ignoring the response code
    this.rpc.sendResponse(parseInt(id), result);
  }
  private emitRequest(peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody): void {
    this.emit("request", peerInfo, method, id, body);
  }
  private emitPeerConnect(peerInfo: PeerInfo): void {
    this.emit("peer:connect", peerInfo);
  }
  private emitPeerDisconnect(peerInfo: PeerInfo): void {
    this.emit("peer:disconnect", peerInfo);
  }

  // service
  public async start(): Promise<void> {
    await this.inited;
    await this.rpc.start();
    // this.pubsub.on(BLOCK_TOPIC, this.handleIncomingBlock.bind(this));
    // this.pubsub.on(ATTESTATION_TOPIC, this.handleIncomingAttestation.bind(this));
    // for (let shard = 0; shard < SHARD_SUBNET_COUNT; shard++) {
    //   this.pubsub.on(shardSubnetAttestationTopic(shard),
    //       this.handleIncomingShardAttestation.bind(this));
    // }
    // this.pubsub.on("gossipsub:heartbeat", this.emitGossipHeartbeat.bind(this));

    this.rpc.on(`gossip:${GossipTopic.Block}`, this.handleIncomingBlock.bind(this));
    this.rpc.on(`gossip:${GossipTopic.Attestation}`, this.handleIncomingAttestation.bind(this));

    this.rpc.on("request", this.emitRequest.bind(this));
    this.rpc.on("peer:connect", this.emitPeerConnect.bind(this));
    this.rpc.on("peer:disconnect", this.emitPeerDisconnect.bind(this));
  }
  public async stop(): Promise<void> {
    await this.inited;
    await this.rpc.stop();
    // this.pubsub.removeListener(BLOCK_TOPIC, this.handleIncomingBlock.bind(this));
    // this.pubsub.removeListener(ATTESTATION_TOPIC, this.handleIncomingAttestation.bind(this));
    // for (let shard = 0; shard < SHARD_SUBNET_COUNT; shard++) {
    //   this.pubsub.removeListener(shardSubnetAttestationTopic(shard),
    //       this.handleIncomingShardAttestation.bind(this));
    // }
    // this.pubsub.removeListener("gossipsub:heartbeat", this.emitGossipHeartbeat.bind(this));

    this.rpc.removeListener(`gossip:${GossipTopic.Block}`, this.handleIncomingBlock.bind(this));
    this.rpc.removeListener(`gossip:${GossipTopic.Attestation}`, this.handleIncomingAttestation.bind(this));

    this.rpc.removeListener("request", this.emitRequest.bind(this));
    this.rpc.removeListener("peer:connect", this.emitPeerConnect.bind(this));
    this.rpc.removeListener("peer:disconnect", this.emitPeerDisconnect.bind(this));
  }

}