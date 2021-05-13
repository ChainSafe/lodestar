import {allForks, altair, phase0} from "@chainsafe/lodestar-types";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {SyncCommitteeSignatureIndexed} from "../../chain/validation/syncCommittee";
import {getCurrentAndNextFork, INetwork} from "../../network";
import {IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {GossipHandlerFn, GossipTopic, GossipType} from "../../network/gossip";

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
  private readonly topicHandlers: {topic: GossipTopic; handler: GossipHandlerFn}[] = [];
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
    for (const {topic, handler} of this.topicHandlers) {
      this.network.gossip.unhandleTopic(topic, handler);
    }

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

  private onBlock = (block: allForks.SignedBeaconBlock): void => {
    this.chain.receiveBlock(block);
  };

  private onAggregatedAttestation = async (aggregate: phase0.SignedAggregateAndProof): Promise<void> => {
    await this.db.aggregateAndProof.add(aggregate.message);
  };

  private onAttesterSlashing = async (attesterSlashing: phase0.AttesterSlashing): Promise<void> => {
    await this.db.attesterSlashing.add(attesterSlashing);
  };

  private onProposerSlashing = async (proposerSlashing: phase0.ProposerSlashing): Promise<void> => {
    await this.db.proposerSlashing.add(proposerSlashing);
  };

  private onVoluntaryExit = async (exit: phase0.SignedVoluntaryExit): Promise<void> => {
    await this.db.voluntaryExit.add(exit);
  };

  private onSyncCommitteeContribution = async (contribution: altair.SignedContributionAndProof): Promise<void> => {
    this.db.syncCommitteeContribution.add(contribution.message);
  };

  private onAttestation = async (subnet: number, attestation: phase0.Attestation): Promise<void> => {
    // TODO: Review if it's really necessary to check shouldProcessAttestation()
    if (this.network.attService.shouldProcessAttestation(subnet, attestation.data.slot)) {
      await this.db.attestation.add(attestation);
    }
  };

  private onSyncCommitteeSignature = async (
    subnet: number,
    signature: altair.SyncCommitteeSignature
  ): Promise<void> => {
    // TODO: Review if we need to check shouldProcessAttestation() like with onAttestation

    // TODO: Do this much better to be able to access this property in the handler
    const indexInSubCommittee = (signature as SyncCommitteeSignatureIndexed).indexInSubCommittee;
    this.db.syncCommitee.add(subnet, signature, indexInSubCommittee);
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
      {type: GossipType.beacon_aggregate_and_proof, handler: this.onAggregatedAttestation},
      {type: GossipType.voluntary_exit, handler: this.onVoluntaryExit},
      {type: GossipType.proposer_slashing, handler: this.onProposerSlashing},
      {type: GossipType.attester_slashing, handler: this.onAttesterSlashing},
      // TODO: Only subscribe after altair
      {type: GossipType.sync_committee_contribution_and_proof, handler: this.onSyncCommitteeContribution},
    ];
    for (const {type, handler} of topicHandlers) {
      const topic = {type, fork: ForkName.phase0} as GossipTopic;
      this.network.gossip.handleTopic(topic, handler as GossipHandlerFn);
      this.topicHandlers.push({topic, handler: handler as GossipHandlerFn});
    }

    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const topic = {type: GossipType.beacon_attestation, fork: ForkName.phase0, subnet};
      const handlerWrapped = (async (attestation: phase0.Attestation): Promise<void> =>
        await this.onAttestation(subnet, attestation)) as GossipHandlerFn;
      this.network.gossip.handleTopic(topic, handlerWrapped);
      this.topicHandlers.push({topic, handler: handlerWrapped});
    }

    // TODO: Only subscribe after altair
    for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
      const topic = {type: GossipType.sync_committee, fork: ForkName.altair, subnet};
      const handlerWrapped = (async (signature: altair.SyncCommitteeSignature): Promise<void> =>
        await this.onSyncCommitteeSignature(subnet, signature)) as GossipHandlerFn;
      this.network.gossip.handleTopic(topic, handlerWrapped);
      this.topicHandlers.push({topic, handler: handlerWrapped});
    }
  }
}
