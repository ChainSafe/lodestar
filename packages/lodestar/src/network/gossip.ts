/* eslint-disable no-empty,@typescript-eslint/no-explicit-any */
/**
 * @module network
 */

import {EventEmitter} from "events";
import {deserialize, serialize} from "@chainsafe/ssz";
import {promisify} from "es6-promisify";
import LibP2p from "libp2p";
//@ts-ignore
import Gossipsub from "libp2p-gossipsub";
import {Attestation, BeaconBlock, Shard} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {ATTESTATION_TOPIC, BLOCK_TOPIC, SHARD_SUBNET_COUNT} from "../constants";
import {ILogger} from "../logger";

import {attestationTopic, blockTopic, shardAttestationTopic, shardSubnetAttestationTopic} from "./util";
import {INetworkOptions} from "./options";
import {GossipEventEmitter, IGossip, IGossipSub,} from "./interface";

interface IGossipModules {
  config: IBeaconConfig;
  libp2p: LibP2p;
  logger: ILogger;
}


export class Gossip extends (EventEmitter as { new(): GossipEventEmitter }) implements IGossip {
  private opts: INetworkOptions;
  private config: IBeaconConfig;
  private libp2p: LibP2p;
  private pubsub: IGossipSub;
  private logger: ILogger;

  public constructor(opts: INetworkOptions, {config, libp2p, logger}: IGossipModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger;
    this.pubsub = new Gossipsub(libp2p, {gossipIncoming: false});
  }

  public async start(): Promise<void> {
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
    await promisify<void, string, Buffer>(this.pubsub.publish.bind(this.pubsub))(
      blockTopic(), serialize(this.config.types.BeaconBlock, block));
    this.logger.verbose(`[GOSSIP] Publishing block at slot: ${block.slot}`);
  }
  public async publishAttestation(attestation: Attestation): Promise<void> {
    await promisify<void, string, Buffer>(this.pubsub.publish.bind(this.pubsub))(
      attestationTopic(), serialize(this.config.types.Attestation, attestation));
    this.logger.verbose(
      `[GOSSIP] Publishing attestation for beacon block root: ${attestation.data.beaconBlockRoot.toString("hex")}`
    );
  }
  public async publishShardAttestation(attestation: Attestation): Promise<void> {
    await promisify<void, string, Buffer>(this.pubsub.publish.bind(this.pubsub))(
      shardSubnetAttestationTopic(attestation.data.crosslink.shard),
      serialize(this.config.types.Attestation, attestation)
    );
    this.logger.verbose(
      `[GOSSIP] Publishing shard attestation for beacon block root: ${attestation.data.beaconBlockRoot.toString("hex")}`
    );
  }
  private handleIncomingBlock = (msg: any): void => {
    try {
      const block: BeaconBlock = deserialize(this.config.types.BeaconBlock, msg.data);
      this.logger.verbose(`[GOSSIP] Incoming block at slot: ${block.slot}`);
      this.emit(BLOCK_TOPIC, block);
    } catch (e) {
      this.logger.warn("[GOSSIP] Incoming block error", e);
    }
  };
  private handleIncomingAttestation = (msg: any): void => {
    try {
      const attestation: Attestation = deserialize(this.config.types.Attestation, msg.data);
      this.logger.verbose(
        `[GOSSIP] Incoming attestation for beacon block root: ${attestation.data.beaconBlockRoot.toString("hex")}`
      );
      this.emit(ATTESTATION_TOPIC, attestation);
    } catch (e) {
      this.logger.warn("[GOSSIP] Incoming attestation error", e);
    }
  };
  private handleIncomingShardAttestation = (msg: any): void => {
    try {
      const attestation: Attestation = deserialize(this.config.types.Attestation, msg.data);
      this.logger.verbose(
        `[GOSSIP] Incoming shard attestation for beacon block root: ${attestation.data.beaconBlockRoot.toString("hex")}`
      );
      // @ts-ignore
      // we cannot type hint this
      this.emit(shardAttestationTopic(attestation.data.crosslink.shard), attestation);
    } catch (e) {
      this.logger.warn("[GOSSIP] Incoming attestation error", e);
    }
  };

  private emitGossipHeartbeat = (): void => {
    this.emit("gossipsub:heartbeat");
  };

}
