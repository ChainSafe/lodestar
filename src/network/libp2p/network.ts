/**
 * @module network/libp2p
 */

import {serialize} from "@chainsafe/ssz";
import promisify from "promisify-es6";
import * as FloodSub from "libp2p-floodsub";
import PeerInfo from "peer-info";

import {Attestation, BeaconBlock, Shard} from "../../types";
import {RpcController} from "./rpcController";
import {INetwork, IPeer} from "../interface";

const BLOCK_TOPIC = "beacon_block";
const ATTESTATION_TOPIC = "beacon_attestation";
const SHARD_SUBNET_COUNT = 10;
const shardAttestationTopic = (shard: Shard): string =>
  `shard${shard % SHARD_SUBNET_COUNT}_attestation`;

export class Libp2pNetwork implements INetwork {
  private libp2p;
  private pubsub: FloodSub;
  private rpc: RpcController;
  private inited: Promise<void>;

  public constructor(conf, {libp2p}) {
    // `libp2p` can be a promise as well as a libp2p object
    this.inited = new Promise((resolve, _) => {
      Promise.resolve(libp2p).then((libp2p) => {
        this.libp2p = libp2p;
        this.pubsub = new FloodSub(libp2p);
        this.rpc = new RpcController(libp2p);
        resolve();
      })
    });
  }

  // pubsub
  public subscribe(topic: string): void {
    this.pubsub.subscribe(topic);
  }
  public unsubscribe(topic: string): void {
    this.pubsub.unsubscribe(topic);
  }
  public async publishBlock(block: BeaconBlock): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      BLOCK_TOPIC, serialize(block, BeaconBlock));
  }
  public async publishAttestation(attestation: Attestation): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      ATTESTATION_TOPIC, serialize(attestation, Attestation));
  }
  public async publishShardAttestation(shard: Shard, attestation: Attestation): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      shardAttestationTopic(shard), serialize(attestation, Attestation));
  }

  // rpc
  public getPeers(): IPeer[] {
    return this.rpc.getPeers();
  }
  public async connect(peerInfo: PeerInfo): Promise<void> {
    await promisify(this.libp2p.dial.bind(this.libp2p))(peerInfo);
  }
  public async disconnect(peer: IPeer): Promise<void> {
    await promisify(this.libp2p.hangUp.bind(this.libp2p))(peer.peerInfo);
  }

  // service
  public async start(): Promise<void> {
    await this.inited;
    await promisify(this.libp2p.start.bind(this))();
    await promisify(this.pubsub.start.bind(this.pubsub))();
    await promisify(this.rpc.start.bind(this.rpc))();
  }
  public async stop(): Promise<void> {
    await this.inited;
    await promisify(this.rpc.stop.bind(this.rpc))();
    await promisify(this.pubsub.stop.bind(this.pubsub))();
    await promisify(this.libp2p.stop.bind(this))();
  }
}
