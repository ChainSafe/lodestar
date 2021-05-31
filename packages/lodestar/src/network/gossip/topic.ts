/**
 * @module network/gossip
 */

import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkDigestContext, toHexStringNoPrefix} from "../../util/forkDigestContext";
import {DEFAULT_ENCODING} from "./constants";
import {GossipEncoding, GossipDeserializer, GossipObject, GossipSerializer, GossipType, GossipTopic} from "./interface";

const gossipTopicRegex = new RegExp("^/eth2/(\\w+)/(\\w+)/(\\w+)");

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

/**
 * Parse a `GossipTopic` object from its stringified form.
 * A gossip topic has the format
 * ```ts
 * /eth2/$FORK_DIGEST/$GOSSIP_TYPE/$ENCODING
 * ```
 */
export function parseGossipTopic(forkDigestContext: IForkDigestContext, topicStr: string): GossipTopic {
  try {
    const matches = topicStr.match(gossipTopicRegex);
    if (matches === null) {
      throw Error(`Must match regex ${gossipTopicRegex}`);
    }

    const [, forkDigestHexNoPrefix, gossipTypeStr, encodingStr] = matches;

    const fork = forkDigestContext.forkDigest2ForkName(forkDigestHexNoPrefix);
    const encoding = parseEncodingStr(encodingStr);

    // Inline-d the parseGossipTopicType() function since spreading the resulting object x4 the time to parse a topicStr
    switch (gossipTypeStr) {
      case GossipType.beacon_block:
      case GossipType.beacon_aggregate_and_proof:
      case GossipType.voluntary_exit:
      case GossipType.proposer_slashing:
      case GossipType.attester_slashing:
      case GossipType.sync_committee_contribution_and_proof:
        return {type: gossipTypeStr, fork, encoding};
    }

    for (const gossipType of [GossipType.beacon_attestation as const, GossipType.sync_committee as const]) {
      if (gossipTypeStr.startsWith(gossipType)) {
        const subnetStr = gossipTypeStr.slice(gossipType.length + 1); // +1 for '_' concatenating the topic name and the subnet
        const subnet = parseInt(subnetStr, 10);
        if (Number.isNaN(subnet)) throw Error(`Subnet ${subnetStr} is not a number`);
        return {type: gossipType, subnet, fork, encoding};
      }
    }

    throw Error(`Unknown gossip type ${gossipTypeStr}`);
  } catch (e) {
    (e as Error).message = `Invalid gossip topic ${topicStr}: ${(e as Error).message}`;
    throw e;
  }
}

/**
 * Validate that a `encodingStr` is a known `GossipEncoding`
 */
function parseEncodingStr(encodingStr: string): GossipEncoding {
  switch (encodingStr) {
    case GossipEncoding.ssz:
    case GossipEncoding.ssz_snappy:
      return encodingStr;

    default:
      throw Error(`Unknown encoding ${encodingStr}`);
  }
}

export function getGossipSSZType<T extends GossipObject>(config: IBeaconConfig, topic: GossipTopic): ContainerType<T> {
  switch (topic.type) {
    case GossipType.beacon_block:
      // beacon_block is updated in altair to support the updated SignedBeaconBlock type
      return (config.types[topic.fork].SignedBeaconBlock as unknown) as ContainerType<T>;
    case GossipType.beacon_aggregate_and_proof:
      return (config.types.phase0.SignedAggregateAndProof as unknown) as ContainerType<T>;
    case GossipType.beacon_attestation:
      return (config.types.phase0.Attestation as unknown) as ContainerType<T>;
    case GossipType.proposer_slashing:
      return (config.types.phase0.ProposerSlashing as unknown) as ContainerType<T>;
    case GossipType.attester_slashing:
      return (config.types.phase0.AttesterSlashing as unknown) as ContainerType<T>;
    case GossipType.voluntary_exit:
      return (config.types.phase0.SignedVoluntaryExit as unknown) as ContainerType<T>;
    case GossipType.sync_committee_contribution_and_proof:
      return (config.types.altair.SignedContributionAndProof as unknown) as ContainerType<T>;
    case GossipType.sync_committee:
      return (config.types.altair.SyncCommitteeSignature as unknown) as ContainerType<T>;
    default:
      throw new Error(`No ssz gossip type for ${(topic as GossipTopic).type}`);
  }
}

/**
 * Return a ssz deserialize function for a gossip topic
 */
export function getGossipSSZDeserializer(config: IBeaconConfig, topic: GossipTopic): GossipDeserializer {
  const sszType = getGossipSSZType(config, topic);

  switch (topic.type) {
    case GossipType.beacon_block:
    case GossipType.beacon_aggregate_and_proof:
      // all other gossip can be deserialized to struct
      return sszType.createTreeBackedFromBytes.bind(sszType);
    case GossipType.beacon_attestation:
    case GossipType.proposer_slashing:
    case GossipType.attester_slashing:
    case GossipType.voluntary_exit:
    case GossipType.sync_committee_contribution_and_proof:
    case GossipType.sync_committee:
      return sszType.deserialize.bind(sszType);
  }
}

/**
 * Return a ssz serialize function for a gossip topic
 */
export function getGossipSSZSerializer(config: IBeaconConfig, topic: GossipTopic): GossipSerializer {
  const sszType = getGossipSSZType(config, topic);
  return sszType.serialize.bind(sszType);
}
