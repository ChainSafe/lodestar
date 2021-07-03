/**
 * @module network/gossip
 */

import {ssz} from "@chainsafe/lodestar-types";
import {IForkDigestContext, toHexStringNoPrefix} from "../../util/forkDigestContext";
import {GossipType, GossipTopic} from "./interface";
import {DEFAULT_ENCODING} from "./constants";

export interface IGossipTopicCache {
  getTopic(topicStr: string): GossipTopic;
}

export class GossipTopicCache implements IGossipTopicCache {
  private topicsByTopicStr = new Map<string, Required<GossipTopic>>();

  getTopic(topicStr: string): GossipTopic {
    const topic = this.topicsByTopicStr.get(topicStr);
    if (topic === undefined) {
      // We should only receive messages from known subscribed topics
      throw Error(`Unsupported topicStr: ${topicStr}`);
    }
    return topic;
  }

  setTOpic(topicStr: string, topic: Required<GossipTopic>): void {
    this.topicsByTopicStr.set(topicStr, topic);
  }
}

/**
 * Stringify a GossipTopic into a spec-ed formated topic string
 */
export function stringifyGossipTopic(forkDigestContext: IForkDigestContext, topic: GossipTopic): string {
  const forkDigest = forkDigestContext.forkName2ForkDigest(topic.fork);
  const forkDigestHexNoPrefix = toHexStringNoPrefix(forkDigest);
  const topicType = stringifyGossipTopicType(topic);
  const encoding = topic.encoding ?? DEFAULT_ENCODING;
  return `/eth2/${forkDigestHexNoPrefix}/${topicType}/${encoding}`;
}

/**
 * Stringify a GossipTopic into a spec-ed formated partial topic string
 */
function stringifyGossipTopicType(topic: GossipTopic): string {
  switch (topic.type) {
    case GossipType.beacon_block:
    case GossipType.beacon_aggregate_and_proof:
    case GossipType.voluntary_exit:
    case GossipType.proposer_slashing:
    case GossipType.attester_slashing:
    case GossipType.sync_committee_contribution_and_proof:
      return topic.type;
    case GossipType.beacon_attestation:
    case GossipType.sync_committee:
      return `${topic.type}_${topic.subnet}`;
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/explicit-function-return-type
export function getGossipSSZType(topic: GossipTopic) {
  switch (topic.type) {
    case GossipType.beacon_block:
      // beacon_block is updated in altair to support the updated SignedBeaconBlock type
      return ssz[topic.fork].SignedBeaconBlock;
    case GossipType.beacon_aggregate_and_proof:
      return ssz.phase0.SignedAggregateAndProof;
    case GossipType.beacon_attestation:
      return ssz.phase0.Attestation;
    case GossipType.proposer_slashing:
      return ssz.phase0.ProposerSlashing;
    case GossipType.attester_slashing:
      return ssz.phase0.AttesterSlashing;
    case GossipType.voluntary_exit:
      return ssz.phase0.SignedVoluntaryExit;
    case GossipType.sync_committee_contribution_and_proof:
      return ssz.altair.SignedContributionAndProof;
    case GossipType.sync_committee:
      return ssz.altair.SyncCommitteeMessage;
    default:
      throw new Error(`No ssz gossip type for ${(topic as GossipTopic).type}`);
  }
}
