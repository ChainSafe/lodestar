/* eslint-disable @typescript-eslint/member-ordering */
/**
 * @module network/gossip
 */

import {EventEmitter} from "events";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ATTESTATION_SUBNET_COUNT} from "../../constants";
import {ILogger, LogLevel} from "@chainsafe/lodestar-utils/lib/logger";
import {getAttestationSubnetEvent, getGossipTopic, mapGossipEvent,} from "./utils";
import {INetworkOptions} from "../options";
import {GossipEventEmitter, GossipObject, IGossip, IGossipEvents, IGossipModules, IGossipSub} from "./interface";
import {GossipEvent} from "./constants";
import {handleIncomingBlock, publishBlock} from "./handlers/block";
import {
  getCommitteeAttestationHandler,
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
  Epoch,
  ForkDigest,
  ProposerSlashing,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  Slot
} from "@chainsafe/lodestar-types";
import {IBeaconChain} from "../../chain";
import {computeEpochAtSlot, computeForkDigest} from "@chainsafe/lodestar-beacon-state-transition";
import {GossipEncoding} from "./encoding";
import {toHexString} from "@chainsafe/ssz";


export type GossipHandlerFn = (this: Gossip, obj: GossipObject ) => void;

export class Gossip extends (EventEmitter as { new(): GossipEventEmitter }) implements IGossip {

  protected readonly  opts: INetworkOptions;
  protected readonly config: IBeaconConfig;
  protected readonly  pubsub: IGossipSub;
  protected readonly chain: IBeaconChain;
  protected readonly  logger: ILogger;

  private handlers: Map<string, GossipHandlerFn>;
  //TODO: make this configurable
  private supportedEncodings = [GossipEncoding.SSZ_SNAPPY, GossipEncoding.SSZ];
  private statusInterval?: NodeJS.Timeout;

  public constructor(
    opts: INetworkOptions,
    {config, libp2p, logger, validator, chain, pubsub}: IGossipModules) {
    super();
    this.opts = opts;
    this.config = config;
    this.logger = logger.child({module: "gossip", level: LogLevel[logger.level]});
    // need to improve Gossipsub type to implement EventEmitter to avoid this cast
    this.pubsub = pubsub || new LodestarGossipsub(config, validator, this.logger,
      libp2p.peerId, libp2p.registrar, {gossipIncoming: true}) as unknown as IGossipSub;
    this.chain = chain;
  }

  public async start(): Promise<void> {
    await this.pubsub.start();
    this.registerHandlers(this.chain.currentForkDigest);
    this.chain.on("forkDigest", this.handleForkDigest);
    this.emit("gossip:start");
    this.logger.verbose("Gossip is started");
    this.statusInterval = setInterval(this.logSubscriptions, 60000);
  }

  public async stop(): Promise<void> {
    this.emit("gossip:stop");
    this.unregisterHandlers();
    this.chain.removeListener("forkDigest", this.handleForkDigest);
    await this.pubsub.stop();
    if(this.statusInterval) {
      clearInterval(this.statusInterval);
    }
    this.logger.verbose("Gossip is stopped");
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
    const subnetNum: number = (typeof subnet === "string")? parseInt(subnet) : subnet as number;
    this.subscribe(forkDigest, getAttestationSubnetEvent(subnetNum), callback,
      new Map([["subnet", subnet.toString()]]));
  }

  public unsubscribeFromAttestationSubnet(
    forkDigest: ForkDigest,
    subnet: number|string,
    callback?: (attestation: {attestation: Attestation; subnet: number}) => void
  ): void {
    const subnetNum: number = (typeof subnet === "string")? parseInt(subnet) : subnet as number;
    this.unsubscribe(forkDigest, getAttestationSubnetEvent(subnetNum), callback,
      new Map([["subnet", subnet.toString()]]));
  }

  public unsubscribe(
    forkDigest: ForkDigest,
    event: keyof IGossipEvents | string,
    listener?: unknown,
    params: Map<string, string> = new Map()): void {
    if(this.listenerCount(event.toString()) === 1 && !event.toString().startsWith("gossipsub")) {
      this.supportedEncodings.forEach((encoding) => {
        this.pubsub.unsubscribe(getGossipTopic(mapGossipEvent(event), forkDigest, encoding, params));
      });
    }
    if(listener) {
      this.removeListener(event as keyof IGossipEvents, listener as (...args: unknown[]) => void);
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
    event: keyof IGossipEvents | string,
    listener?: unknown,
    params: Map<string, string> = new Map()): void {
    if(this.listenerCount(event.toString()) === 0 && !event.toString().startsWith("gossipsub")) {
      this.supportedEncodings.forEach((encoding) => {
        this.pubsub.subscribe(getGossipTopic(mapGossipEvent(event), forkDigest, encoding, params));
      });
    }
    if(listener) {
      this.on(event as keyof IGossipEvents, listener as (...args: unknown[]) => void);
    }
  }

  private handleForkDigest = async (forkDigest: ForkDigest): Promise<void> => {
    this.logger.important(`Gossip: received new fork digest ${toHexString(forkDigest)}`);
    this.unregisterHandlers();
    this.registerHandlers(forkDigest);
  };

  private registerHandlers(forkDigest: ForkDigest): void {
    this.handlers = this.createHandlers(forkDigest);
    this.handlers.forEach((handler, topic) => {
      this.pubsub.on(topic, handler);
    });
  }

  private unregisterHandlers(): void {
    if (this.handlers) {
      this.handlers.forEach((handler, topic) => {
        this.pubsub.removeListener(topic, handler);
      });
    }
  }

  private createHandlers(forkDigest: ForkDigest): Map<string, GossipHandlerFn> {
    const handlers = new Map();
    handlers.set("gossipsub:heartbeat", this.emitGossipHeartbeat);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;
    this.supportedEncodings.forEach((encoding) => {
      handlers.set(getGossipTopic(GossipEvent.BLOCK, forkDigest, encoding),
        handleIncomingBlock.bind(that));
      handlers.set(getGossipTopic(GossipEvent.AGGREGATE_AND_PROOF, forkDigest, encoding),
        handleIncomingAggregateAndProof.bind(that));
      handlers.set(getGossipTopic(GossipEvent.ATTESTER_SLASHING, forkDigest, encoding),
        handleIncomingAttesterSlashing.bind(that));
      handlers.set(getGossipTopic(GossipEvent.PROPOSER_SLASHING, forkDigest, encoding),
        handleIncomingProposerSlashing.bind(that));
      handlers.set(getGossipTopic(GossipEvent.VOLUNTARY_EXIT, forkDigest, encoding),
        handleIncomingVoluntaryExit.bind(that));

      for(let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const committeeAttestationHandler = getCommitteeAttestationHandler(subnet);
        handlers.set(
          getGossipTopic(
            GossipEvent.ATTESTATION_SUBNET,
            forkDigest,
            encoding,
            new Map([["subnet", String(subnet)]])
          ),
          committeeAttestationHandler.bind(that)
        );
      }
    });
    return handlers;
  }


  private emitGossipHeartbeat = (): void => {
    this.emit("gossipsub:heartbeat");
  };

  private logSubscriptions = (): void => {
    if (this.pubsub && this.pubsub.subscriptions) {
      this.logger.info("Current gossip subscriptions: " + Array.from(this.pubsub.subscriptions).join(","));
    } else {
      this.logger.info("No gossip subscriptions");
    }
  };

}
