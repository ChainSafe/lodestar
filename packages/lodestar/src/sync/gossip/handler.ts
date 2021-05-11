import {phase0, Version} from "@chainsafe/lodestar-types";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";

import {INetwork} from "../../network";
import {ChainEvent, IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {GossipHandlerFn, GossipTopic, GossipType} from "../../network/gossip";

enum GossipHandlerStatus {
  Started = "Started",
  Stopped = "Stopped",
}

type GossipHandlerState = {status: GossipHandlerStatus.Stopped} | {status: GossipHandlerStatus.Started; fork: ForkName};

export class BeaconGossipHandler {
  private readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private state: GossipHandlerState = {status: GossipHandlerStatus.Stopped};

  constructor(config: IBeaconConfig, chain: IBeaconChain, network: INetwork, db: IBeaconDb) {
    this.config = config;
    this.chain = chain;
    this.network = network;
    this.db = db;

    this.addGossipHandlers();
  }

  get isStarted(): boolean {
    return this.state.status === GossipHandlerStatus.Started;
  }

  close(): void {
    this.removeGossipHandlers();
    if (this.state.status === GossipHandlerStatus.Started) {
      this.stop();
    }
  }

  /**
   * Subscribe to all gossip events
   */
  start(): void {
    if (this.state.status === GossipHandlerStatus.Started) {
      return;
    }

    const fork = this.chain.getHeadForkName();
    this.subscribeAtFork(fork);
    this.state = {status: GossipHandlerStatus.Started, fork};
    this.chain.emitter.on(ChainEvent.forkVersion, this.handleForkVersion);
  }

  /**
   * Unsubscribe from all gossip events
   */
  stop(): void {
    if (this.state.status !== GossipHandlerStatus.Started) {
      return;
    }

    this.chain.emitter.off(ChainEvent.forkVersion, this.handleForkVersion);
    this.unsubscribeAtFork(this.state.fork);
    this.state = {status: GossipHandlerStatus.Stopped};
  }

  onBlock = (block: phase0.SignedBeaconBlock): void => {
    this.chain.receiveBlock(block);
  };

  onAggregatedAttestation = async (aggregate: phase0.SignedAggregateAndProof): Promise<void> => {
    await this.db.aggregateAndProof.add(aggregate.message);
  };

  onAttesterSlashing = async (attesterSlashing: phase0.AttesterSlashing): Promise<void> => {
    await this.db.attesterSlashing.add(attesterSlashing);
  };

  onProposerSlashing = async (proposerSlashing: phase0.ProposerSlashing): Promise<void> => {
    await this.db.proposerSlashing.add(proposerSlashing);
  };

  onVoluntaryExit = async (exit: phase0.SignedVoluntaryExit): Promise<void> => {
    await this.db.voluntaryExit.add(exit);
  };

  private subscribeAtFork = (fork: ForkName): void => {
    this.network.gossip.subscribeTopic({type: GossipType.beacon_block, fork});
    this.network.gossip.subscribeTopic({type: GossipType.beacon_aggregate_and_proof, fork});
    this.network.gossip.subscribeTopic({type: GossipType.voluntary_exit, fork});
    this.network.gossip.subscribeTopic({type: GossipType.proposer_slashing, fork});
    this.network.gossip.subscribeTopic({type: GossipType.attester_slashing, fork});
  };

  private unsubscribeAtFork = (fork: ForkName): void => {
    this.network.gossip.unsubscribeTopic({type: GossipType.beacon_block, fork});
    this.network.gossip.unsubscribeTopic({type: GossipType.beacon_aggregate_and_proof, fork});
    this.network.gossip.unsubscribeTopic({type: GossipType.voluntary_exit, fork});
    this.network.gossip.unsubscribeTopic({type: GossipType.proposer_slashing, fork});
    this.network.gossip.unsubscribeTopic({type: GossipType.attester_slashing, fork});
  };

  private handleForkVersion = (_forkVersion: Version, fork: ForkName): void => {
    if (this.state.status !== GossipHandlerStatus.Started) {
      return;
    }

    this.unsubscribeAtFork(this.state.fork);
    this.subscribeAtFork(fork);
    this.state = {status: GossipHandlerStatus.Started, fork};
  };

  private addGossipHandlers(): void {
    // phase 0
    const topicHandlers = [
      {type: GossipType.beacon_block, handler: this.onBlock},
      {
        type: GossipType.beacon_aggregate_and_proof,
        handler: this.onAggregatedAttestation,
      },
      {type: GossipType.voluntary_exit, handler: this.onVoluntaryExit},
      {type: GossipType.proposer_slashing, handler: this.onProposerSlashing},
      {type: GossipType.attester_slashing, handler: this.onAttesterSlashing},
    ];
    for (const {type, handler} of topicHandlers) {
      const topic = {type, fork: ForkName.phase0};
      this.network.gossip.handleTopic(topic as GossipTopic, handler as GossipHandlerFn);
    }
    // TODO altair
  }

  private removeGossipHandlers(): void {
    // phase 0
    const topicHandlers = [
      {type: GossipType.beacon_block, handler: this.onBlock},
      {
        type: GossipType.beacon_aggregate_and_proof,
        handler: this.onAggregatedAttestation,
      },
      {type: GossipType.voluntary_exit, handler: this.onVoluntaryExit},
      {type: GossipType.proposer_slashing, handler: this.onProposerSlashing},
      {type: GossipType.attester_slashing, handler: this.onAttesterSlashing},
    ];
    for (const {type, handler} of topicHandlers) {
      const topic = {type, fork: ForkName.phase0};
      this.network.gossip.unhandleTopic(topic as GossipTopic, handler as GossipHandlerFn);
    }
    // TODO altair
  }
}
