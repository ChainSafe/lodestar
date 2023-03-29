import {PublishResult} from "@libp2p/interface-pubsub";
import {PublishOpts} from "@chainsafe/libp2p-gossipsub/types";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {allForks, altair, capella, deneb, phase0} from "@lodestar/types";
import {Logger} from "@lodestar/utils";

import {BlockInput, BlockInputType} from "../../chain/blocks/types.js";
import {PublisherBeaconNode, GossipTopicMap, GossipType, GossipTypeMap} from "./interface.js";
import {getGossipSSZType, gossipTopicIgnoreDuplicatePublishError, stringifyGossipTopic} from "./topic.js";

/**
 * Gossip publishing module decoupled from the underlying publish mechanism
 */
export class GossipPublisher implements PublisherBeaconNode {
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly publishGossip: (topic: string, data: Uint8Array, opts?: PublishOpts) => Promise<PublishResult>;

  constructor(modules: {
    config: BeaconConfig;
    logger: Logger;
    publishGossip: (topic: string, data: Uint8Array, opts?: PublishOpts) => Promise<PublishResult>;
  }) {
    const {config, logger, publishGossip} = modules;

    this.config = config;
    this.logger = logger;
    this.publishGossip = publishGossip;
  }

  /**
   * Publish a `GossipObject` on a `GossipTopic`
   */
  async publishObject<K extends GossipType>(
    topic: GossipTopicMap[K],
    object: GossipTypeMap[K],
    opts?: PublishOpts | undefined
  ): Promise<PublishResult> {
    const topicStr = stringifyGossipTopic(this.config, topic);
    const sszType = getGossipSSZType(topic);
    const messageData = (sszType.serialize as (object: GossipTypeMap[GossipType]) => Uint8Array)(object);
    opts = {
      ...opts,
      ignoreDuplicatePublishError: gossipTopicIgnoreDuplicatePublishError[topic.type],
    };
    const result = await this.publishGossip(topicStr, messageData, opts);

    const sentPeers = result.recipients.length;
    this.logger.verbose("Publish to topic", {topic: topicStr, sentPeers});
    return result;
  }

  async publishBeaconBlockMaybeBlobs(blockInput: BlockInput): Promise<PublishResult> {
    switch (blockInput.type) {
      case BlockInputType.preDeneb:
        return this.publishBeaconBlock(blockInput.block);

      case BlockInputType.postDeneb:
        return this.publishSignedBeaconBlockAndBlobsSidecar({
          beaconBlock: blockInput.block as deneb.SignedBeaconBlock,
          blobsSidecar: blockInput.blobs,
        });
    }
  }

  async publishBeaconBlock(signedBlock: allForks.SignedBeaconBlock): Promise<PublishResult> {
    const fork = this.config.getForkName(signedBlock.message.slot);
    return this.publishObject<GossipType.beacon_block>({type: GossipType.beacon_block, fork}, signedBlock, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishSignedBeaconBlockAndBlobsSidecar(item: deneb.SignedBeaconBlockAndBlobsSidecar): Promise<PublishResult> {
    const fork = this.config.getForkName(item.beaconBlock.message.slot);
    return this.publishObject<GossipType.beacon_block_and_blobs_sidecar>(
      {type: GossipType.beacon_block_and_blobs_sidecar, fork},
      item,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishBeaconAggregateAndProof(aggregateAndProof: phase0.SignedAggregateAndProof): Promise<PublishResult> {
    const fork = this.config.getForkName(aggregateAndProof.message.aggregate.data.slot);
    return this.publishObject<GossipType.beacon_aggregate_and_proof>(
      {type: GossipType.beacon_aggregate_and_proof, fork},
      aggregateAndProof,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishBeaconAttestation(attestation: phase0.Attestation, subnet: number): Promise<PublishResult> {
    const fork = this.config.getForkName(attestation.data.slot);
    return this.publishObject<GossipType.beacon_attestation>(
      {type: GossipType.beacon_attestation, fork, subnet},
      attestation,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishVoluntaryExit(voluntaryExit: phase0.SignedVoluntaryExit): Promise<PublishResult> {
    const fork = this.config.getForkName(computeStartSlotAtEpoch(voluntaryExit.message.epoch));
    return this.publishObject<GossipType.voluntary_exit>({type: GossipType.voluntary_exit, fork}, voluntaryExit, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishBlsToExecutionChange(blsToExecutionChange: capella.SignedBLSToExecutionChange): Promise<PublishResult> {
    const fork = ForkName.capella;
    return this.publishObject<GossipType.bls_to_execution_change>(
      {type: GossipType.bls_to_execution_change, fork},
      blsToExecutionChange,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishProposerSlashing(proposerSlashing: phase0.ProposerSlashing): Promise<PublishResult> {
    const fork = this.config.getForkName(Number(proposerSlashing.signedHeader1.message.slot as bigint));
    return this.publishObject<GossipType.proposer_slashing>(
      {type: GossipType.proposer_slashing, fork},
      proposerSlashing
    );
  }

  async publishAttesterSlashing(attesterSlashing: phase0.AttesterSlashing): Promise<PublishResult> {
    const fork = this.config.getForkName(Number(attesterSlashing.attestation1.data.slot as bigint));
    return this.publishObject<GossipType.attester_slashing>(
      {type: GossipType.attester_slashing, fork},
      attesterSlashing
    );
  }

  async publishSyncCommitteeSignature(signature: altair.SyncCommitteeMessage, subnet: number): Promise<PublishResult> {
    const fork = this.config.getForkName(signature.slot);
    return this.publishObject<GossipType.sync_committee>({type: GossipType.sync_committee, fork, subnet}, signature, {
      ignoreDuplicatePublishError: true,
    });
  }

  async publishContributionAndProof(contributionAndProof: altair.SignedContributionAndProof): Promise<PublishResult> {
    const fork = this.config.getForkName(contributionAndProof.message.contribution.slot);
    return this.publishObject<GossipType.sync_committee_contribution_and_proof>(
      {type: GossipType.sync_committee_contribution_and_proof, fork},
      contributionAndProof,
      {ignoreDuplicatePublishError: true}
    );
  }

  async publishLightClientFinalityUpdate(
    lightClientFinalityUpdate: allForks.LightClientFinalityUpdate
  ): Promise<PublishResult> {
    const fork = this.config.getForkName(lightClientFinalityUpdate.signatureSlot);
    return this.publishObject<GossipType.light_client_finality_update>(
      {type: GossipType.light_client_finality_update, fork},
      lightClientFinalityUpdate
    );
  }

  async publishLightClientOptimisticUpdate(
    lightClientOptimisitcUpdate: allForks.LightClientOptimisticUpdate
  ): Promise<PublishResult> {
    const fork = this.config.getForkName(lightClientOptimisitcUpdate.signatureSlot);
    return this.publishObject<GossipType.light_client_optimistic_update>(
      {type: GossipType.light_client_optimistic_update, fork},
      lightClientOptimisitcUpdate
    );
  }
}
