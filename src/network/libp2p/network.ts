/**
 * @module network/libp2p
 */

import {EventEmitter} from "events";
import {serialize, deserialize} from "@chainsafe/ssz";
import promisify from "promisify-es6";
import LibP2p from "libp2p";
import Gossipsub from "libp2p-gossipsub";
import PeerInfo from "peer-info";

import {Attestation, BeaconBlock, Shard, RequestBody, ResponseBody} from "../../types";
import {BLOCK_TOPIC, ATTESTATION_TOPIC, SHARD_SUBNET_COUNT} from "../../constants";
import {INetwork, INetworkOptions} from "../interface";
import {Method, RequestId} from "../codec";
import {shardAttestationTopic, shardSubnetAttestationTopic} from "../util";
import {NetworkRpc} from "./rpc";


export class Libp2pNetwork extends EventEmitter implements INetwork {
  public peerInfo: PeerInfo;
  private opts: INetworkOptions;
  private libp2p: LibP2p;
  private pubsub: Gossipsub;
  private rpc: NetworkRpc;
  private inited: Promise<void>;

  public constructor(opts: INetworkOptions, {libp2p}) {
    super();
    this.opts = opts;
    // `libp2p` can be a promise as well as a libp2p object
    this.inited = new Promise((resolve) => {
      Promise.resolve(libp2p).then((libp2p) => {
        this.peerInfo = libp2p.peerInfo;
        this.libp2p = libp2p;
        this.pubsub = new Gossipsub(libp2p);
        this.rpc = new NetworkRpc(libp2p);
        resolve();
      });
    });
  }

  // pubsub
  public subscribeToBlocks(): void {
    this.pubsub.subscribe(BLOCK_TOPIC);
  }
  public subscribeToAttestations(): void {
    this.pubsub.subscribe(ATTESTATION_TOPIC);
  }
  public subscribeToShardAttestations(shard: Shard): void {
    this.pubsub.subscribe(shardSubnetAttestationTopic(shard));
  }
  public unsubscribeToBlocks(): void {
    this.pubsub.unsubscribe(BLOCK_TOPIC);
  }
  public unsubscribeToAttestations(): void {
    this.pubsub.unsubscribe(ATTESTATION_TOPIC);
  }
  public unsubscribeToShardAttestations(shard: Shard): void {
    this.pubsub.unsubscribe(shardSubnetAttestationTopic(shard));
  }
  public async publishBlock(block: BeaconBlock): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      BLOCK_TOPIC, serialize(block, BeaconBlock));
  }
  public async publishAttestation(attestation: Attestation): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      ATTESTATION_TOPIC, serialize(attestation, Attestation));
  }
  public async publishShardAttestation(attestation: Attestation): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      shardSubnetAttestationTopic(attestation.data.shard), serialize(attestation, Attestation));
  }
  private handleIncomingBlock(msg: any): void {
    try {
      const block: BeaconBlock = deserialize(msg.data, BeaconBlock);
      this.emit(BLOCK_TOPIC, block);
    } catch (e) {
    }
  }
  private handleIncomingAttestation(msg: any): void {
    try {
      const attestation: Attestation = deserialize(msg.data, Attestation);
      this.emit(ATTESTATION_TOPIC, attestation);
    } catch (e) {
    }
  }
  private handleIncomingShardAttestation(msg: any): void {
    try {
      const attestation: Attestation = deserialize(msg.data, Attestation);
      this.emit(shardAttestationTopic(attestation.data.shard), attestation);
    } catch (e) {
    }
  }
  private emitGossipHeartbeat(): void {
    this.emit("gossipsub:heartbeat");
  }

  // rpc
  public getPeers(): PeerInfo[] {
    return this.rpc.getPeers();
  }
  public hasPeer(peerInfo: PeerInfo): boolean {
    return this.rpc.hasPeer(peerInfo);
  }
  public async connect(peerInfo: PeerInfo): Promise<void> {
    await promisify(this.libp2p.dial.bind(this.libp2p))(peerInfo);
  }
  public async disconnect(peerInfo: PeerInfo): Promise<void> {
    await promisify(this.libp2p.hangUp.bind(this.libp2p))(peerInfo);
  }
  public async sendRequest<T extends ResponseBody>(peerInfo: PeerInfo, method: Method, body: RequestBody): Promise<T> {
    return await this.rpc.sendRequest<T>(peerInfo, method, body);
  }
  public sendResponse(id: RequestId, responseCode: number, result: ResponseBody): void {
    this.rpc.sendResponse(id, responseCode, result);
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
    await promisify(this.libp2p.start.bind(this.libp2p))();
    await promisify(this.pubsub.start.bind(this.pubsub))();
    await this.rpc.start();
    this.pubsub.on(BLOCK_TOPIC, this.handleIncomingBlock.bind(this));
    this.pubsub.on(ATTESTATION_TOPIC, this.handleIncomingAttestation.bind(this));
    for (let shard = 0; shard < SHARD_SUBNET_COUNT; shard++) {
      this.pubsub.on(shardSubnetAttestationTopic(shard),
        this.handleIncomingShardAttestation.bind(this));
    }
    this.pubsub.on("gossipsub:heartbeat", this.emitGossipHeartbeat.bind(this));
    this.rpc.on("request", this.emitRequest.bind(this));
    this.rpc.on("peer:connect", this.emitPeerConnect.bind(this));
    this.rpc.on("peer:disconnect", this.emitPeerDisconnect.bind(this));
  }
  public async stop(): Promise<void> {
    await this.inited;
    await this.rpc.stop();
    await promisify(this.pubsub.stop.bind(this.pubsub))();
    await promisify(this.libp2p.stop.bind(this.libp2p))();
    this.pubsub.removeListener(BLOCK_TOPIC, this.handleIncomingBlock.bind(this));
    this.pubsub.removeListener(ATTESTATION_TOPIC, this.handleIncomingAttestation.bind(this));
    for (let shard = 0; shard < SHARD_SUBNET_COUNT; shard++) {
      this.pubsub.removeListener(shardSubnetAttestationTopic(shard),
        this.handleIncomingShardAttestation.bind(this));
    }
    this.pubsub.removeListener("gossipsub:heartbeat", this.emitGossipHeartbeat.bind(this));
    this.rpc.removeListener("request", this.emitRequest.bind(this));
    this.rpc.removeListener("peer:connect", this.emitPeerConnect.bind(this));
    this.rpc.removeListener("peer:disconnect", this.emitPeerDisconnect.bind(this));
  }
}
