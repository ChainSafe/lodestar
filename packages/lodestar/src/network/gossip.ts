/**
 * @module network
 */

import {EventEmitter} from "events";
import {deserialize, serialize} from "@chainsafe/ssz";
import promisify from "promisify-es6";
import LibP2p from "libp2p";
import Gossipsub from "libp2p-gossipsub";
import {Attestation, BeaconBlock, Shard} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {SHARD_SUBNET_COUNT, BLOCK_TOPIC, ATTESTATION_TOPIC} from "../constants";
import {ILogger} from "../logger";
import {IBeaconMetrics} from "../metrics";

import {shardAttestationTopic, shardSubnetAttestationTopic, blockTopic, attestationTopic} from "./util";
import {INetworkOptions} from "./options";
import {
  IGossip, GossipEventEmitter,
} from "./interface";

interface GossipModules {
  config: IBeaconConfig;
  libp2p: any;
  logger: ILogger;
}


export class Gossip extends (EventEmitter as { new(): GossipEventEmitter }) implements IGossip {
  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private pubsub: Gossipsub;
  private logger: ILogger;

  public constructor(opts: INetworkOptions, {config, libp2p, logger}: GossipModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.pubsub = new Gossipsub(libp2p, {gossipIncoming: false});
  }

  public subscribeToBlocks(): void {
    this.pubsub.subscribe(blockTopic());
  }
  public subscribeToAttestations(): void {
    this.pubsub.subscribe(attestationTopic());
  }
  public subscribeToShardAttestations(shard: Shard): void {
    this.pubsub.subscribe(shardSubnetAttestationTopic(shard));
  }
  public unsubscribeToBlocks(): void {
    this.pubsub.unsubscribe(blockTopic());
  }
  public unsubscribeToAttestations(): void {
    this.pubsub.unsubscribe(attestationTopic());
  }
  public unsubscribeToShardAttestations(shard: Shard): void {
    this.pubsub.unsubscribe(shardSubnetAttestationTopic(shard));
  }
  public async publishBlock(block: BeaconBlock): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      blockTopic(), serialize(block, this.config.types.BeaconBlock));
  }
  public async publishAttestation(attestation: Attestation): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      attestationTopic(), serialize(attestation, this.config.types.Attestation));
  }
  public async publishShardAttestation(attestation: Attestation): Promise<void> {
    await promisify(this.pubsub.publish.bind(this.pubsub))(
      shardSubnetAttestationTopic(attestation.data.crosslink.shard), serialize(attestation, this.config.types.Attestation));
  }
  private handleIncomingBlock = (msg: any): void => {
    try {
      const block: BeaconBlock = deserialize(msg.data, this.config.types.BeaconBlock);
      this.emit(BLOCK_TOPIC, block);
    } catch (e) {
    }
  };
  private handleIncomingAttestation = (msg: any): void => {
    try {
      const attestation: Attestation = deserialize(msg.data, this.config.types.Attestation);
      this.emit(ATTESTATION_TOPIC, attestation);
    } catch (e) {
    }
  };
  private handleIncomingShardAttestation = (msg: any): void => {
    try {
      const attestation: Attestation = deserialize(msg.data, this.config.types.Attestation);
      // @ts-ignore
      // we cannot type hint this
      this.emit(shardAttestationTopic(attestation.data.crosslink.shard), attestation);
    } catch (e) {
    }
  };
  private emitGossipHeartbeat = (): void => {
    this.emit("gossipsub:heartbeat");
  };

  // service
  public async start(): Promise<void> {
    console.log("gossip start", blockTopic())
    await promisify(this.pubsub.start.bind(this.pubsub))();
    this.pubsub.on(blockTopic(), this.handleIncomingBlock);
    this.pubsub.on(attestationTopic(), this.handleIncomingAttestation);
    for (let shard = 0; shard < SHARD_SUBNET_COUNT; shard++) {
      this.pubsub.on(shardSubnetAttestationTopic(shard),
        this.handleIncomingShardAttestation);
    }
    this.pubsub.on("gossipsub:heartbeat", this.emitGossipHeartbeat);
  }
  public async stop(): Promise<void> {
    await promisify(this.pubsub.stop.bind(this.pubsub))();
    this.pubsub.removeListener(blockTopic(), this.handleIncomingBlock);
    this.pubsub.removeListener(attestationTopic(), this.handleIncomingAttestation);
    for (let shard = 0; shard < SHARD_SUBNET_COUNT; shard++) {
      this.pubsub.removeListener(shardSubnetAttestationTopic(shard),
        this.handleIncomingShardAttestation);
    }
    this.pubsub.removeListener("gossipsub:heartbeat", this.emitGossipHeartbeat);
  }
}
