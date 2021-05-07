import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";

import {getCurrentAndNextFork, INetwork} from "../../network";
import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {GossipHandlerFn, GossipTopic, GossipType} from "../../network/gossip";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

enum GossipHandlerStatus {
  Started = "Started",
  Stopped = "Stopped",
}

type GossipHandlerState =
  | {status: GossipHandlerStatus.Stopped}
  | {status: GossipHandlerStatus.Started; forks: ForkName[]};

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

    const epoch = computeEpochAtSlot(this.config, this.chain.forkChoice.getHead().slot);
    const {currentFork, nextFork} = getCurrentAndNextFork(this.config, epoch);
    const subscribedForks: ForkName[] = [];
    subscribedForks.push(currentFork.name);
    if (nextFork) subscribedForks.push(nextFork.name);
    for (const fork of subscribedForks) {
      this.subscribeAtFork(fork);
    }
    this.state = {status: GossipHandlerStatus.Started, forks: subscribedForks};
  }

  /**
   * Unsubscribe from all gossip events
   */
  stop(): void {
    if (this.state.status !== GossipHandlerStatus.Started) {
      return;
    }
    for (const fork of this.state.forks) {
      this.unsubscribeAtFork(fork);
    }
    this.state = {status: GossipHandlerStatus.Stopped};
  }

  onBlock = (block: allForks.SignedBeaconBlock): void => {
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

  onSyncCommitteeContribution = async (syncCommitteeContribution: altair.SignedContributionAndProof): Promise<void> => {
    this.db.seenSyncCommitteeContributionCache.addContributionAndProof(syncCommitteeContribution.message);
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

  private addGossipHandlers(): void {
    const topicHandlers = [
      {type: GossipType.beacon_block, handler: this.onBlock},
      {
        type: GossipType.beacon_aggregate_and_proof,
        handler: this.onAggregatedAttestation,
      },
      {type: GossipType.voluntary_exit, handler: this.onVoluntaryExit},
      {type: GossipType.proposer_slashing, handler: this.onProposerSlashing},
      {type: GossipType.attester_slashing, handler: this.onAttesterSlashing},
      {type: GossipType.sync_committee_contribution_and_proof, handler: this.onSyncCommitteeContribution},
    ];
    for (const {type, handler} of topicHandlers) {
      const topic = {type, fork: ForkName.phase0};
      this.network.gossip.handleTopic(topic as GossipTopic, handler as GossipHandlerFn);
    }
  }

  private removeGossipHandlers(): void {
    const topicHandlers = [
      {type: GossipType.beacon_block, handler: this.onBlock},
      {
        type: GossipType.beacon_aggregate_and_proof,
        handler: this.onAggregatedAttestation,
      },
      {type: GossipType.voluntary_exit, handler: this.onVoluntaryExit},
      {type: GossipType.proposer_slashing, handler: this.onProposerSlashing},
      {type: GossipType.attester_slashing, handler: this.onAttesterSlashing},
      {type: GossipType.sync_committee_contribution_and_proof, handler: this.onSyncCommitteeContribution},
    ];
    for (const {type, handler} of topicHandlers) {
      const topic = {type, fork: ForkName.phase0};
      this.network.gossip.unhandleTopic(topic as GossipTopic, handler as GossipHandlerFn);
    }
  }
}
