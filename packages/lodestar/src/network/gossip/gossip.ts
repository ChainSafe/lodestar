/* eslint-disable @typescript-eslint/member-ordering */
/**
 * @module network/gossip
 */

import {EventEmitter} from "events";
import {promisify} from "es6-promisify";
import LibP2p from "libp2p";
//@ts-ignore
import Gossipsub from "libp2p-gossipsub";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {ILogger, LogLevel} from "@chainsafe/eth2.0-utils/lib/logger";
import {getAttestationSubnet, getGossipTopic,} from "./utils";
import {INetworkOptions} from "../options";
import {
  GossipEventEmitter,
  IGossip,
  IGossipEvents,
  IGossipMessage,
  IGossipMessageValidator,
  IGossipModules,
  IGossipSub
} from "./interface";
import {GossipEvent} from "./constants";
import {getIncomingBlockHandler, publishBlock} from "./handlers/block";
import {
  getCommitteeAttestationHandler,
  getIncomingAttestationHandler,
  publishCommiteeAttestation
} from "./handlers/attestation";
import {getIncomingAttesterSlashingHandler, publishAttesterSlashing} from "./handlers/attesterSlashing";
import {getIncomingProposerSlashingHandler, publishProposerSlashing} from "./handlers/proposerSlashing";
import {getIncomingVoluntaryExitHandler, publishVoluntaryExit} from "./handlers/voluntaryExit";
import {getIncomingAggregateAndProofHandler, publishAggregatedAttestation} from "./handlers/aggregateAndProof";
import {
  AggregateAndProof,
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  ProposerSlashing,
  VoluntaryExit
} from "@chainsafe/eth2.0-types";

export type GossipHandlerFn = (this: Gossip, msg: IGossipMessage) => void;

export class Gossip extends (EventEmitter as { new(): GossipEventEmitter }) implements IGossip {

  protected readonly  opts: INetworkOptions;
  protected readonly config: IBeaconConfig;
  protected readonly  libp2p: LibP2p;
  protected readonly  pubsub: IGossipSub;
  protected readonly  logger: ILogger;

  private handlers: Map<string, GossipHandlerFn>;
  private validator: IGossipMessageValidator;

  public constructor(opts: INetworkOptions, {config, libp2p, logger, validator}: IGossipModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger.child({module: "gossip", level: LogLevel[logger.level]});
    this.logger.silent = logger.silent;
    this.validator = validator;
    this.pubsub = new Gossipsub(libp2p, {gossipIncoming: false});
    this.handlers = this.registerHandlers();
  }

  public async start(): Promise<void> {
    await promisify(this.pubsub.start.bind(this.pubsub))();
    this.handlers.forEach((handler, topic) => {
      this.pubsub.on(topic, handler);
    });
  }

  public async stop(): Promise<void> {
    await promisify(this.pubsub.stop.bind(this.pubsub))();
    this.handlers.forEach((handler, topic) => {
      this.pubsub.removeListener(topic, handler);
    });
  }

  public publishBlock = publishBlock;

  public publishCommiteeAttestation = publishCommiteeAttestation;

  public publishAggregatedAttestation = publishAggregatedAttestation;

  public publishVoluntaryExit = publishVoluntaryExit;

  public publishProposerSlashing = publishProposerSlashing;

  public publishAttesterSlashing = publishAttesterSlashing;

  public subscribeToBlock(callback: (block: BeaconBlock) => void): void {
    this.subscribe(GossipEvent.BLOCK, callback);
  }

  public subscribeToAggregateAndProof(callback: (aggregate: AggregateAndProof) => void): void {
    this.subscribe(GossipEvent.AGGREGATE_AND_PROOF, callback);
  }

  public subscribeToAttestation(callback: (attestation: Attestation) => void): void {
    this.subscribe(GossipEvent.ATTESTATION, callback);
  }

  public subscribeToVoluntaryExit(callback: (voluntaryExit: VoluntaryExit) => void): void {
    this.subscribe(GossipEvent.VOLUNTARY_EXIT, callback);
  }

  public subscribeToProposerSlashing(callback: (slashing: ProposerSlashing) => void): void {
    this.subscribe(GossipEvent.PROPOSER_SLASHING, callback);
  }

  public subscribeToAttesterSlashing(callback: (slashing: AttesterSlashing) => void): void {
    this.subscribe(GossipEvent.ATTESTER_SLASHING, callback);
  }

  public subscribeToAttestationSubnet(subnet: number|string, callback: (block: BeaconBlock) => void): void {
    this.subscribe(GossipEvent.ATTESTATION_SUBNET, callback, new Map([["subnet", subnet.toString()]]));
  }

  public unsubscribeFromAttestationSubnet(subnet: number|string, callback: (block: BeaconBlock) => void): void {
    this.unsubscribe(GossipEvent.ATTESTATION_SUBNET, callback, new Map([["subnet", subnet.toString()]]));
  }

  public unsubscribe(event: keyof IGossipEvents, listener: unknown, params: Map<string, string> = new Map()): void {
    if(this.listenerCount(event) === 1 && !event.startsWith("gossipsub")) {
      this.pubsub.unsubscribe(getGossipTopic(event as GossipEvent, "ssz", params));
    }
    this.removeListener(event, listener as (...args: unknown[]) => void);
  }

  private subscribe(event: keyof IGossipEvents, listener: unknown, params: Map<string, string> = new Map()): void {
    if(this.listenerCount(event) === 0 && !event.startsWith("gossipsub")) {
      this.pubsub.subscribe(getGossipTopic(event as GossipEvent, "ssz", params));
    }
    this.on(event, listener as (...args: unknown[]) => void);
  }

  private registerHandlers(): Map<string, GossipHandlerFn> {
    const handlers = new Map();
    handlers.set("gossipsub:heartbeat", this.emitGossipHeartbeat);
    handlers.set(getGossipTopic(GossipEvent.BLOCK, "ssz"),
      getIncomingBlockHandler(this.validator).bind(this));
    handlers.set(getGossipTopic(GossipEvent.ATTESTATION, "ssz"),
      getIncomingAttestationHandler(this.validator).bind(this));
    handlers.set(getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, "ssz"),
      getIncomingAggregateAndProofHandler(this.validator).bind(this));
    handlers.set(getGossipTopic(GossipEvent.ATTESTER_SLASHING, "ssz"),
      getIncomingAttesterSlashingHandler(this.validator).bind(this));
    handlers.set(getGossipTopic(GossipEvent.PROPOSER_SLASHING, "ssz"),
      getIncomingProposerSlashingHandler(this.validator).bind(this));
    handlers.set(getGossipTopic(GossipEvent.VOLUNTARY_EXIT, "ssz"),
      getIncomingVoluntaryExitHandler(this.validator).bind(this));

    for(let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const committeeAttestationHandler = getCommitteeAttestationHandler(subnet, this.validator);
      handlers.set(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          "ssz",
          new Map([["subnet", String(subnet)]])
        ),
        committeeAttestationHandler.bind(this)
      );
    }
    return handlers;
  }


  private emitGossipHeartbeat = (): void => {
    this.emit("gossipsub:heartbeat");
  };

}
