import {allForks, altair, Epoch, phase0} from "@chainsafe/lodestar-types";
import {ATTESTATION_SUBNET_COUNT, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {IBeaconConfig, ForkName} from "@chainsafe/lodestar-config";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {ILogger} from "@chainsafe/lodestar-utils";
import {SyncCommitteeSignatureIndexed} from "../../chain/validation/syncCommittee";
import {getActiveForks, runForkTransitionHooks} from "../forks";
import {ChainEvent, IBeaconChain} from "../../chain";
import {IBeaconDb} from "../../db";
import {GossipHandlerFn, GossipTopic, GossipType} from ".";
import {Eth2Gossipsub} from "./gossipsub";
import {IAttnetsService} from "../subnets";

/**
 * Registers handlers to all possible gossip topics and forks.
 * Other components control when to subscribe and unsubcribe.
 */
export class GossipHandler {
  private readonly topicHandlers: {topic: GossipTopic; handler: GossipHandlerFn}[] = [];
  private subscribedForks = new Set<ForkName>();

  constructor(
    private readonly config: IBeaconConfig,
    private readonly chain: IBeaconChain,
    private readonly gossip: Eth2Gossipsub,
    private readonly attnetsService: IAttnetsService,
    private readonly db: IBeaconDb,
    private readonly logger: ILogger
  ) {
    this.registerGossipHandlers();
    this.chain.emitter.on(ChainEvent.clockEpoch, this.onEpoch);
  }

  close(): void {
    this.chain.emitter.off(ChainEvent.clockEpoch, this.onEpoch);
    for (const {topic, handler} of this.topicHandlers) {
      this.gossip.unhandleTopic(topic, handler);
    }
  }

  get isSubscribedToCoreTopics(): boolean {
    return this.subscribedForks.size > 0;
  }

  /**
   * Subscribe to all gossip events. Safe to call multiple times
   */
  subscribeCoreTopics(): void {
    if (!this.isSubscribedToCoreTopics) {
      this.logger.info("Subscribed gossip core topics");
    }

    const currentEpoch = computeEpochAtSlot(this.config, this.chain.forkChoice.getHead().slot);
    for (const fork of getActiveForks(this.config, currentEpoch)) {
      this.subscribeCoreTopicsAtFork(fork);
    }
  }

  /**
   * Unsubscribe from all gossip events. Safe to call multiple times
   */
  unsubscribeCoreTopics(): void {
    for (const fork of this.subscribedForks.values()) {
      this.unsubscribeCoreTopicsAtFork(fork);
    }
  }

  // Handle forks

  private onEpoch = (epoch: Epoch): void => {
    try {
      // Don't subscribe to new fork if the node is not subscribed to any topic
      if (!this.isSubscribedToCoreTopics) {
        return;
      }

      runForkTransitionHooks(this.config, epoch, {
        beforeForkTransition: (nextFork) => {
          this.logger.info("Suscribing gossip core topics to next fork", {nextFork});
          this.subscribeCoreTopicsAtFork(nextFork);
        },
        afterForkTransition: (prevFork) => {
          this.logger.info("Unsuscribing gossip core topics from prev fork", {prevFork});
          this.unsubscribeCoreTopicsAtFork(prevFork);
        },
      });
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e);
    }
  };

  // Gossip handlers

  private onBlock = (block: allForks.SignedBeaconBlock): void => {
    this.logger.verbose("Received gossip block", {slot: block.message.slot});
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
    if (this.attnetsService.shouldProcess(subnet, attestation.data.slot)) {
      await this.db.attestation.add(attestation);
    }
  };

  private onSyncCommitteeSignature = async (
    subnet: number,
    signature: altair.SyncCommitteeSignature
  ): Promise<void> => {
    // Note: not calling checking `syncnetsService.shouldProcess()` here since the validators will always aggregate

    // TODO: Do this much better to be able to access this property in the handler
    const indexInSubCommittee = (signature as SyncCommitteeSignatureIndexed).indexInSubCommittee;
    this.db.syncCommittee.add(subnet, signature, indexInSubCommittee);
  };

  private subscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (this.subscribedForks.has(fork)) return;
    this.subscribedForks.add(fork);

    this.gossip.subscribeTopic({type: GossipType.beacon_block, fork});
    this.gossip.subscribeTopic({type: GossipType.beacon_aggregate_and_proof, fork});
    this.gossip.subscribeTopic({type: GossipType.voluntary_exit, fork});
    this.gossip.subscribeTopic({type: GossipType.proposer_slashing, fork});
    this.gossip.subscribeTopic({type: GossipType.attester_slashing, fork});
    if (fork === ForkName.altair) {
      this.gossip.subscribeTopic({type: GossipType.sync_committee_contribution_and_proof, fork});
    }
  };

  private unsubscribeCoreTopicsAtFork = (fork: ForkName): void => {
    if (!this.subscribedForks.has(fork)) return;
    this.subscribedForks.delete(fork);

    this.gossip.unsubscribeTopic({type: GossipType.beacon_block, fork});
    this.gossip.unsubscribeTopic({type: GossipType.beacon_aggregate_and_proof, fork});
    this.gossip.unsubscribeTopic({type: GossipType.voluntary_exit, fork});
    this.gossip.unsubscribeTopic({type: GossipType.proposer_slashing, fork});
    this.gossip.unsubscribeTopic({type: GossipType.attester_slashing, fork});
    if (fork === ForkName.altair) {
      this.gossip.unsubscribeTopic({type: GossipType.sync_committee_contribution_and_proof, fork});
    }
  };

  private registerGossipHandlers(): void {
    const topicHandlers = [
      {type: GossipType.beacon_block, handler: this.onBlock},
      {type: GossipType.beacon_aggregate_and_proof, handler: this.onAggregatedAttestation},
      {type: GossipType.voluntary_exit, handler: this.onVoluntaryExit},
      {type: GossipType.proposer_slashing, handler: this.onProposerSlashing},
      {type: GossipType.attester_slashing, handler: this.onAttesterSlashing},
      // Note: Calling .handleTopic() does not subscribe. Safe to do in any fork
      {type: GossipType.sync_committee_contribution_and_proof, handler: this.onSyncCommitteeContribution},
    ];
    const currentEpoch = computeEpochAtSlot(this.config, this.chain.forkChoice.getHead().slot);
    for (const fork of getActiveForks(this.config, currentEpoch)) {
      for (const {type, handler} of topicHandlers) {
        const topic = {type, fork} as GossipTopic;
        this.gossip.handleTopic(topic, handler as GossipHandlerFn);
        this.topicHandlers.push({topic, handler: handler as GossipHandlerFn});
      }
      for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
        const topic = {type: GossipType.beacon_attestation, fork, subnet};
        const handlerWrapped = (async (attestation: phase0.Attestation): Promise<void> =>
          await this.onAttestation(subnet, attestation)) as GossipHandlerFn;
        this.gossip.handleTopic(topic, handlerWrapped);
        this.topicHandlers.push({topic, handler: handlerWrapped});
      }
      if (fork === ForkName.altair) {
        // Note: Calling .handleTopic() does not subscribe. Safe to do in any fork// TODO: Only subscribe after altair
        for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
          const topic = {type: GossipType.sync_committee, fork, subnet};
          const handlerWrapped = (async (signature: altair.SyncCommitteeSignature): Promise<void> =>
            await this.onSyncCommitteeSignature(subnet, signature)) as GossipHandlerFn;
          this.gossip.handleTopic(topic, handlerWrapped);
          this.topicHandlers.push({topic, handler: handlerWrapped});
        }
      }
    }
  }
}
