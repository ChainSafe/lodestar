/* eslint-disable @typescript-eslint/member-ordering */
/**
 * @module network/gossip
 */

import {EventEmitter} from "events";
import LibP2p from "libp2p";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {ILogger, LogLevel} from "@chainsafe/lodestar-utils/lib/logger";
import {getGossipTopic,} from "./utils";
import {INetworkOptions} from "../options";
import {GossipEventEmitter, GossipObject, IGossip, IGossipEvents, IGossipModules, IGossipSub} from "./interface";
import {GossipEvent} from "./constants";
import {handleIncomingBlock, publishBlock} from "./handlers/block";
import {
  getCommitteeAttestationHandler,
  handleIncomingAttestation,
  publishCommiteeAttestation
} from "./handlers/attestation";
import {handleIncomingAttesterSlashing, publishAttesterSlashing} from "./handlers/attesterSlashing";
import {handleIncomingProposerSlashing, publishProposerSlashing} from "./handlers/proposerSlashing";
import {handleIncomingVoluntaryExit, publishVoluntaryExit} from "./handlers/voluntaryExit";
import {handleIncomingAggregateAndProof, publishAggregatedAttestation} from "./handlers/aggregateAndProof";
import {LodestarGossipsub} from "./gossipsub";
import {
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  Slot,
  ForkDigest,
  Epoch,
  SignedAggregateAndProof
} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../chain";
import {computeForkDigest, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";


export type GossipHandlerFn = (this: Gossip, obj: GossipObject ) => void;

export class Gossip extends (EventEmitter as { new(): GossipEventEmitter }) implements IGossip {

  protected readonly  opts: INetworkOptions;
  protected readonly config: IBeaconConfig;
  protected readonly  libp2p: LibP2p;
  protected readonly  pubsub: IGossipSub;
  protected readonly chain: IBeaconChain;
  protected readonly  logger: ILogger;

  private handlers: Map<string, GossipHandlerFn>;

  public constructor(opts: INetworkOptions, {config, libp2p, logger, validator, chain}: IGossipModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.libp2p = libp2p;
    this.logger = logger.child({module: "gossip", level: LogLevel[logger.level]});
    this.pubsub = new LodestarGossipsub(config, validator, this.logger,
      libp2p.peerInfo, libp2p.registrar, {gossipIncoming: true});
    this.chain = chain;
  }

  public async start(): Promise<void> {
    this.handlers = this.registerHandlers();
    await this.pubsub.start();
    this.handlers.forEach((handler, topic) => {
      this.pubsub.on(topic, handler);
    });
  }

  public async stop(): Promise<void> {
    await this.pubsub.stop();
    this.handlers.forEach((handler, topic) => {
      this.pubsub.removeListener(topic, handler);
    });
  }

  public publishBlock = publishBlock.bind(this);

  public publishCommiteeAttestation = publishCommiteeAttestation.bind(this);

  public publishAggregatedAttestation = publishAggregatedAttestation.bind(this);

  public publishVoluntaryExit = publishVoluntaryExit.bind(this);

  public publishProposerSlashing = publishProposerSlashing.bind(this);

  public publishAttesterSlashing = publishAttesterSlashing.bind(this);

  public subscribeToBlock(forkDigest: ForkDigest, callback: (block: SignedBeaconBlock) => void): void {
    this.subscribe(forkDigest, GossipEvent.BLOCK, callback);
  }

  public subscribeToAggregateAndProof(
    forkDigest: ForkDigest, callback: (signedAggregate: SignedAggregateAndProof) => void): void {
    this.subscribe(forkDigest, GossipEvent.AGGREGATE_AND_PROOF, callback);
  }

  public subscribeToAttestation(
    forkDigest: ForkDigest, callback: (attestation: Attestation) => void): void {
    this.subscribe(forkDigest, GossipEvent.ATTESTATION, callback);
  }

  public subscribeToVoluntaryExit(
    forkDigest: ForkDigest, callback: (signed: SignedVoluntaryExit) => void): void {
    this.subscribe(forkDigest, GossipEvent.VOLUNTARY_EXIT, callback);
  }

  public subscribeToProposerSlashing(
    forkDigest: ForkDigest, callback: (slashing: ProposerSlashing) => void): void {
    this.subscribe(forkDigest, GossipEvent.PROPOSER_SLASHING, callback);
  }

  public subscribeToAttesterSlashing(
    forkDigest: ForkDigest, callback: (slashing: AttesterSlashing) => void): void {
    this.subscribe(forkDigest, GossipEvent.ATTESTER_SLASHING, callback);
  }

  public subscribeToAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number|string,
    callback?: (attestation: {attestation: Attestation; subnet: number}) => void
  ): void {
    this.subscribe(forkDigest, GossipEvent.ATTESTATION_SUBNET, callback, new Map([["subnet", subnet.toString()]]));
  }

  public unsubscribeFromAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number|string,
    callback?: (attestation: {attestation: Attestation; subnet: number}) => void
  ): void {
    this.unsubscribe(forkDigest, GossipEvent.ATTESTATION_SUBNET, callback, new Map([["subnet", subnet.toString()]]));
  }

  public unsubscribe(
    forkDigest: ForkDigest,
    event: keyof IGossipEvents,
    listener?: unknown,
    params: Map<string, string> = new Map()): void {
    if(this.listenerCount(event) === 1 && !event.startsWith("gossipsub")) {
      this.pubsub.unsubscribe(getGossipTopic(event as GossipEvent, forkDigest, "ssz", params));
    }
    if(listener) {
      this.removeListener(event, listener as (...args: unknown[]) => void);
    }
  }

  public async getForkDigest(slot: Slot): Promise<ForkDigest> {
    const epoch = computeEpochAtSlot(this.config, slot);
    return this.getForkDigestByEpoch(epoch);
  }

  public async getForkDigestByEpoch(epoch: Epoch): Promise<ForkDigest> {
    const state = await this.chain.getHeadState();
    const forkVersion = epoch < state.fork.epoch
      ? state.fork.previousVersion
      : state.fork.currentVersion;
    return computeForkDigest(this.config, forkVersion, state.genesisValidatorsRoot);
  }

  private subscribe(
    forkDigest: ForkDigest,
    event: keyof IGossipEvents,
    listener?: unknown,
    params: Map<string, string> = new Map()): void {
    if(this.listenerCount(event) === 0 && !event.startsWith("gossipsub")) {
      this.pubsub.subscribe(getGossipTopic(event as GossipEvent, forkDigest, "ssz", params));
    }
    if(listener) {
      this.on(event, listener as (...args: unknown[]) => void);
    }
  }

  private registerHandlers(): Map<string, GossipHandlerFn> {
    const forkDigest = this.chain.currentForkDigest;
    const handlers = new Map();
    handlers.set("gossipsub:heartbeat", this.emitGossipHeartbeat);
    handlers.set(getGossipTopic(GossipEvent.BLOCK, forkDigest, "ssz"),
      handleIncomingBlock.bind(this));
    handlers.set(getGossipTopic(GossipEvent.ATTESTATION, forkDigest, "ssz"),
      handleIncomingAttestation.bind(this));
    handlers.set(getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, forkDigest, "ssz"),
      handleIncomingAggregateAndProof.bind(this));
    handlers.set(getGossipTopic(GossipEvent.ATTESTER_SLASHING, forkDigest, "ssz"),
      handleIncomingAttesterSlashing.bind(this));
    handlers.set(getGossipTopic(GossipEvent.PROPOSER_SLASHING, forkDigest, "ssz"),
      handleIncomingProposerSlashing.bind(this));
    handlers.set(getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkDigest, "ssz"),
      handleIncomingVoluntaryExit.bind(this));

    for(let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const committeeAttestationHandler = getCommitteeAttestationHandler(subnet);
      handlers.set(
        getGossipTopic(
          GossipEvent.ATTESTATION_SUBNET,
          forkDigest,
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
