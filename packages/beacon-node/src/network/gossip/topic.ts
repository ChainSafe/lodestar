import {ssz, Attestation, sszTypesFor} from "@lodestar/types";
import {ForkDigestContext} from "@lodestar/config";
import {
  ATTESTATION_SUBNET_COUNT,
  ForkName,
  ForkSeq,
  SYNC_COMMITTEE_SUBNET_COUNT,
  isForkLightClient,
  MAX_BLOBS_PER_BLOCK,
} from "@lodestar/params";

import {GossipAction, GossipActionError, GossipErrorCode} from "../../chain/errors/gossipValidation.js";
import {GossipEncoding, GossipTopic, GossipType, GossipTopicTypeMap, SSZTypeOfGossipTopic} from "./interface.js";
import {DEFAULT_ENCODING} from "./constants.js";

export interface IGossipTopicCache {
  getTopic(topicStr: string): GossipTopic;
}

export class GossipTopicCache implements IGossipTopicCache {
  private topicsByTopicStr = new Map<string, Required<GossipTopic>>();

  constructor(private readonly forkDigestContext: ForkDigestContext) {}

  /** Returns cached GossipTopic, otherwise attempts to parse it from the str */
  getTopic(topicStr: string): GossipTopic {
    let topic = this.topicsByTopicStr.get(topicStr);
    if (topic === undefined) {
      topic = parseGossipTopic(this.forkDigestContext, topicStr);
      // TODO: Consider just throwing here. We should only receive messages from known subscribed topics
      this.topicsByTopicStr.set(topicStr, topic);
    }
    return topic;
  }

  /** Returns cached GossipTopic, otherwise returns undefined */
  getKnownTopic(topicStr: string): GossipTopic | undefined {
    return this.topicsByTopicStr.get(topicStr);
  }

  setTopic(topicStr: string, topic: GossipTopic): void {
    if (!this.topicsByTopicStr.has(topicStr)) {
      this.topicsByTopicStr.set(topicStr, {encoding: DEFAULT_ENCODING, ...topic});
    }
  }
}

/**
 * Stringify a GossipTopic into a spec-ed formated topic string
 */
export function stringifyGossipTopic(forkDigestContext: ForkDigestContext, topic: GossipTopic): string {
  const forkDigestHexNoPrefix = forkDigestContext.forkName2ForkDigestHex(topic.fork);
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
    case GossipType.light_client_finality_update:
    case GossipType.light_client_optimistic_update:
    case GossipType.bls_to_execution_change:
      return topic.type;
    case GossipType.beacon_attestation:
    case GossipType.sync_committee:
      return `${topic.type}_${topic.subnet}`;
    case GossipType.blob_sidecar:
      return `${topic.type}_${topic.index}`;
  }
}

export function getGossipSSZType(topic: GossipTopic) {
  switch (topic.type) {
    case GossipType.beacon_block:
      // beacon_block is updated in altair to support the updated SignedBeaconBlock type
      return ssz[topic.fork].SignedBeaconBlock;
    case GossipType.blob_sidecar:
      return ssz.deneb.BlobSidecar;
    case GossipType.beacon_aggregate_and_proof:
      return sszTypesFor(topic.fork).SignedAggregateAndProof;
    case GossipType.beacon_attestation:
      return sszTypesFor(topic.fork).Attestation;
    case GossipType.proposer_slashing:
      return ssz.phase0.ProposerSlashing;
    case GossipType.attester_slashing:
      return sszTypesFor(topic.fork).AttesterSlashing;
    case GossipType.voluntary_exit:
      return ssz.phase0.SignedVoluntaryExit;
    case GossipType.sync_committee_contribution_and_proof:
      return ssz.altair.SignedContributionAndProof;
    case GossipType.sync_committee:
      return ssz.altair.SyncCommitteeMessage;
    case GossipType.light_client_optimistic_update:
      return isForkLightClient(topic.fork)
        ? sszTypesFor(topic.fork).LightClientOptimisticUpdate
        : ssz.altair.LightClientOptimisticUpdate;
    case GossipType.light_client_finality_update:
      return isForkLightClient(topic.fork)
        ? sszTypesFor(topic.fork).LightClientFinalityUpdate
        : ssz.altair.LightClientFinalityUpdate;
    case GossipType.bls_to_execution_change:
      return ssz.capella.SignedBLSToExecutionChange;
  }
}

/**
 * Deserialize a gossip serialized data into an ssz object.
 */
export function sszDeserialize<T extends GossipTopic>(topic: T, serializedData: Uint8Array): SSZTypeOfGossipTopic<T> {
  const sszType = getGossipSSZType(topic);
  try {
    return sszType.deserialize(serializedData) as SSZTypeOfGossipTopic<T>;
  } catch (_e) {
    throw new GossipActionError(GossipAction.REJECT, {code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE});
  }
}

/**
 * Deserialize a gossip serialized data into an Attestation object.
 */
export function sszDeserializeAttestation(fork: ForkName, serializedData: Uint8Array): Attestation {
  try {
    return sszTypesFor(fork).Attestation.deserialize(serializedData);
  } catch (_e) {
    throw new GossipActionError(GossipAction.REJECT, {code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE});
  }
}

// Parsing

const gossipTopicRegex = /^\/eth2\/(\w+)\/(\w+)\/(\w+)/;

/**
 * Parse a `GossipTopic` object from its stringified form.
 * A gossip topic has the format
 * ```ts
 * /eth2/$FORK_DIGEST/$GOSSIP_TYPE/$ENCODING
 * ```
 */
export function parseGossipTopic(forkDigestContext: ForkDigestContext, topicStr: string): Required<GossipTopic> {
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
      case GossipType.light_client_finality_update:
      case GossipType.light_client_optimistic_update:
      case GossipType.bls_to_execution_change:
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

    if (gossipTypeStr.startsWith(GossipType.blob_sidecar)) {
      const indexStr = gossipTypeStr.slice(GossipType.blob_sidecar.length + 1); // +1 for '_' concatenating the topic name and the index
      const index = parseInt(indexStr, 10);
      if (Number.isNaN(index)) throw Error(`index ${indexStr} is not a number`);
      return {type: GossipType.blob_sidecar, index, fork, encoding};
    }

    throw Error(`Unknown gossip type ${gossipTypeStr}`);
  } catch (e) {
    (e as Error).message = `Invalid gossip topic ${topicStr}: ${(e as Error).message}`;
    throw e;
  }
}

/**
 * De-duplicate logic to pick fork topics between subscribeCoreTopicsAtFork and unsubscribeCoreTopicsAtFork
 */
export function getCoreTopicsAtFork(
  fork: ForkName,
  opts: {subscribeAllSubnets?: boolean; disableLightClientServer?: boolean}
): GossipTopicTypeMap[keyof GossipTopicTypeMap][] {
  // Common topics for all forks
  const topics: GossipTopicTypeMap[keyof GossipTopicTypeMap][] = [
    {type: GossipType.beacon_block},
    {type: GossipType.beacon_aggregate_and_proof},
    {type: GossipType.voluntary_exit},
    {type: GossipType.proposer_slashing},
    {type: GossipType.attester_slashing},
  ];

  // After Deneb also track blob_sidecar_{index}
  if (ForkSeq[fork] >= ForkSeq.deneb) {
    for (let index = 0; index < MAX_BLOBS_PER_BLOCK; index++) {
      topics.push({type: GossipType.blob_sidecar, index});
    }
  }

  // capella
  if (ForkSeq[fork] >= ForkSeq.capella) {
    topics.push({type: GossipType.bls_to_execution_change});
  }

  // Any fork after altair included
  if (ForkSeq[fork] >= ForkSeq.altair) {
    topics.push({type: GossipType.sync_committee_contribution_and_proof});
    if (!opts.disableLightClientServer) {
      topics.push({type: GossipType.light_client_optimistic_update});
      topics.push({type: GossipType.light_client_finality_update});
    }
  }

  if (opts.subscribeAllSubnets) {
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      topics.push({type: GossipType.beacon_attestation, subnet});
    }
    if (ForkSeq[fork] >= ForkSeq.altair) {
      for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
        topics.push({type: GossipType.sync_committee, subnet});
      }
    }
  }

  return topics;
}

/**
 * Validate that a `encodingStr` is a known `GossipEncoding`
 */
function parseEncodingStr(encodingStr: string): GossipEncoding {
  switch (encodingStr) {
    case GossipEncoding.ssz_snappy:
      return encodingStr;

    default:
      throw Error(`Unknown encoding ${encodingStr}`);
  }
}

// TODO: Review which yes, and which not
export const gossipTopicIgnoreDuplicatePublishError: Record<GossipType, boolean> = {
  [GossipType.beacon_block]: true,
  [GossipType.blob_sidecar]: true,
  [GossipType.beacon_aggregate_and_proof]: true,
  [GossipType.beacon_attestation]: true,
  [GossipType.voluntary_exit]: true,
  [GossipType.proposer_slashing]: false, // Why not this ones?
  [GossipType.attester_slashing]: false,
  [GossipType.sync_committee_contribution_and_proof]: true,
  [GossipType.sync_committee]: true,
  [GossipType.light_client_finality_update]: false,
  [GossipType.light_client_optimistic_update]: false,
  [GossipType.bls_to_execution_change]: true,
};
