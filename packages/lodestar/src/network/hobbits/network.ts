/**
 * @module network/hobbits
 */

import {EventEmitter} from "events";
import {INetwork} from "../interface";
import {HobbitsConnectionHandler} from "./hobbitsConnectionHandler";
import {ILogger} from "../../logger";
import {Attestation, BeaconBlock, Shard} from "../../types";
import net from "net";
import PeerInfo from "peer-info";
import NodeAddress = Multiaddr.NodeAddress;
import {deserialize} from "@chainsafe/ssz";
import {ATTESTATION_TOPIC, BLOCK_TOPIC} from "../../constants";
import {shardAttestationTopic} from "../util";
import {HobbitsUri} from "./hobbitsUri";
import {INetworkOptions} from "../options";
import {IBeaconConfig} from "../../config";

export  class HobbitsP2PNetwork extends EventEmitter implements INetwork {
  public peerInfo: PeerInfo;
  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private rpc: HobbitsConnectionHandler;
  private inited: Promise<void>;
  private logger: ILogger;
  public running: boolean;


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
    // this.pubsub.subscribe(BLOCK_TOPIC);
  }
  public subscribeToAttestations(): void {
    // this.pubsub.subscribe(ATTESTATION_TOPIC);
  }
  public subscribeToShardAttestations(shard: Shard): void {
    // this.pubsub.subscribe(shardSubnetAttestationTopic(shard));
  }
  public unsubscribeToBlocks(): void {
    // this.pubsub.unsubscribe(BLOCK_TOPIC);
  }
  public unsubscribeToAttestations(): void {
    // this.pubsub.unsubscribe(ATTESTATION_TOPIC);
  }
  public unsubscribeToShardAttestations(shard: Shard): void {
    // this.pubsub.unsubscribe(shardSubnetAttestationTopic(shard));
  }
  public async publishBlock(block: BeaconBlock): Promise<void> {
    // await promisify(this.pubsub.publish.bind(this.pubsub))(
    //     BLOCK_TOPIC, serialize(block, BeaconBlock));
  }
  public async publishAttestation(attestation: Attestation): Promise<void> {
    // await promisify(this.pubsub.publish.bind(this.pubsub))(
    //     ATTESTATION_TOPIC, serialize(attestation, Attestation));
  }
  public async publishShardAttestation(attestation: Attestation): Promise<void> {
    // await promisify(this.pubsub.publish.bind(this.pubsub))(
    //     shardSubnetAttestationTopic(attestation.data.shard), serialize(attestation, Attestation));
  }
  private handleIncomingBlock(msg: any): void {
    try {
      const block: BeaconBlock = deserialize(msg.data, this.config.types.BeaconBlock);
      this.emit(BLOCK_TOPIC, block);
    } catch (e) {
    }
  }
  private handleIncomingAttestation(msg: any): void {
    try {
      const attestation: Attestation = deserialize(msg.data, this.config.types.Attestation);
      this.emit(ATTESTATION_TOPIC, attestation);
    } catch (e) {
    }
  }
  private handleIncomingShardAttestation(msg: any): void {
    try {
      const attestation: Attestation = deserialize(msg.data, this.config.types.Attestation);
      this.emit(shardAttestationTopic(attestation.data.crosslink.shard), attestation);
    } catch (e) {
    }
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
  // public async sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T> {
  //   return await this.rpc.sendRequest<T>(peerInfo, method, body);
  // }
  // public sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void {
  //   this.rpc.sendResponse(id, responseCode, result);
  // }
  // private emitRequest(peerInfo: PeerInfo, method: Method, id: RequestId, body: RequestBody): void {
  //   this.emit("request", peerInfo, method, id, body);
  // }
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
    // this.rpc.on("request", this.emitRequest.bind(this));
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
    // this.rpc.removeListener("request", this.emitRequest.bind(this));
    this.rpc.removeListener("peer:connect", this.emitPeerConnect.bind(this));
    this.rpc.removeListener("peer:disconnect", this.emitPeerDisconnect.bind(this));
  }

}