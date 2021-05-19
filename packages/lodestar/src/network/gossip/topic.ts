/**
 * @module network/gossip
 */

import {ContainerType, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkDigestContext} from "../../util/forkDigestContext";
import {
  GossipEncoding,
  GossipDeserializer,
  GossipObject,
  GossipSerializer,
  GossipType,
  GossipTopic,
  GossipTopicMap,
} from "./interface";
import {DEFAULT_ENCODING} from "./constants";

/**
 * Create a gossip topic string
 */
export function getGossipTopicString(forkDigestContext: IForkDigestContext, topic: GossipTopic): string {
  const forkDigest = forkDigestContext.forkName2ForkDigest(topic.fork);
  const forkDigestHex = toHexString(forkDigest).toLowerCase().substring(2);
  let topicType: string = topic.type;
  if (topic.type === GossipType.beacon_attestation) {
    topicType += "_" + topic.subnet;
  }
  if (topic.type === GossipType.sync_committee) {
    topicType += "_" + topic.subnet;
  }
  return `/eth2/${forkDigestHex}/${topicType}/${topic.encoding ?? DEFAULT_ENCODING}`;
}

// eslint-disable-next-line @typescript-eslint/naming-convention
export const GossipTopicRegExp = new RegExp("^(/eth2/)([a-f0-9]{8})/(\\w+)/(\\w+)");

// eslint-disable-next-line @typescript-eslint/naming-convention
export const AttestationSubnetRegExp = new RegExp("^/eth2/[a-f0-9]{8}/beacon_attestation_([0-9]+)/\\w+$");

export function isAttestationSubnetTopic(topic: string): boolean {
  return AttestationSubnetRegExp.test(topic);
}

export function getSubnetFromAttestationSubnetTopic(topic: string): number {
  const groups = topic.match(AttestationSubnetRegExp);
  const subnetStr = groups && groups[1];
  if (!subnetStr) throw Error(`Bad attestation topic format: ${topic}`);
  return Number(subnetStr);
}

/**
 * Create a `GossipTopic` from a gossip topic string
 */
export function getGossipTopic(forkDigestContext: IForkDigestContext, topic: string): GossipTopic {
  const groups = topic.match(GossipTopicRegExp);
  if (!groups) {
    throw Error(`Bad gossip topic string: ${topic}`);
  }

  const forkDigestHex = groups[2] as string | undefined;
  const type = groups[3] as GossipType | undefined;
  const encoding = groups[4] as GossipEncoding | undefined;
  if (!forkDigestHex || !type || !encoding) {
    throw Error(`Bad gossip topic string: ${topic}`);
  }

  const fork = forkDigestContext.forkDigest2ForkName(forkDigestHex);

  if (GossipEncoding[encoding] == null) {
    throw new Error(`Bad gossip topic encoding: ${encoding}`);
  }

  if (isAttestationSubnetTopic(topic)) {
    const subnet = getSubnetFromAttestationSubnetTopic(topic);
    return {
      type: GossipType.beacon_attestation,
      fork,
      encoding,
      subnet,
    };
  }
  if (GossipType[type] == null) {
    throw new Error(`Bad gossip topic type: ${type}`);
  }
  return {
    type,
    fork,
    encoding,
  } as GossipTopicMap[GossipType.beacon_block];
}

export function getGossipSSZType<T extends GossipObject>(config: IBeaconConfig, topic: GossipTopic): ContainerType<T> {
  switch (topic.type) {
    case GossipType.beacon_block:
      // beacon_block topic is updated in altair to support the updated SignedBeaconBlock type
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
