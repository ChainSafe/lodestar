import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IForkDigestContext} from "../../../util/forkDigestContext";
import {stringifyGossipTopic} from "../topic";
import {DEFAULT_ENCODING} from "../constants";
import {
  GossipType,
  TopicValidatorFn,
  GossipTopic,
  ValidatorFnsByTopic,
  ValidatorFnsByType,
  TopicsByTopicStrMap,
} from "../interface";

// Gossip validation functions are wrappers around chain-level validation functions
// With a few additional elements:
//
// - Gossip error handling - chain-level validation throws eg: `BlockErrorCode` with many possible error types.
//   Gossip validation functions instead throw either "ignore" or "reject" errors.
//
// - Logging - chain-level validation has no logging.
//   For gossip, its useful to know, via logs/metrics, when gossip is received/ignored/rejected.
//
// - Gossip type conversion - Gossip validation functions operate on messages of binary data.
//   This data must be deserialized into the proper type, determined by the topic (fork digest)
//   This deserialization must have happened prior to the topic validator running.

export function createValidatorFnsByTopic(
  config: IBeaconConfig,
  forkDigestContext: IForkDigestContext,
  validatorFnsByType: ValidatorFnsByType
): {validatorFnsByTopic: ValidatorFnsByTopic; topicsByTopicStr: TopicsByTopicStrMap} {
  const validatorFnsByTopic = new Map<string, TopicValidatorFn>();
  const topicsByTopicStr = new Map<string, Required<GossipTopic>>();

  const encoding = DEFAULT_ENCODING;
  const allForkNames = Object.values(config.forks).map((fork) => fork.name);
  // TODO: Compute all forks after altair including altair
  const allForksAfterAltair = allForkNames.filter((fork) => fork !== ForkName.phase0);

  const staticGossipTypes = [
    {type: GossipType.beacon_block, forks: allForkNames},
    {type: GossipType.beacon_aggregate_and_proof, forks: allForkNames},
    {type: GossipType.voluntary_exit, forks: allForkNames},
    {type: GossipType.proposer_slashing, forks: allForkNames},
    {type: GossipType.attester_slashing, forks: allForkNames},
    // Note: Calling .handleTopic() does not subscribe. Safe to do in any fork
    {type: GossipType.sync_committee_contribution_and_proof, forks: allForksAfterAltair},
  ];

  for (const {type, forks} of staticGossipTypes) {
    for (const fork of forks) {
      const topic = {type, fork, encoding} as Required<GossipTopic>;
      const topicStr = stringifyGossipTopic(forkDigestContext, topic);
      validatorFnsByTopic.set(topicStr, validatorFnsByType[type]);
      topicsByTopicStr.set(topicStr, topic);
    }
  }

  for (const fork of allForkNames) {
    for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
      const topic = {type: GossipType.beacon_attestation, fork, subnet, encoding};
      const topicStr = stringifyGossipTopic(forkDigestContext, topic);
      const topicValidatorFn = validatorFnsByType[GossipType.beacon_attestation];
      validatorFnsByTopic.set(topicStr, topicValidatorFn);
      topicsByTopicStr.set(topicStr, topic);
    }
  }

  for (const fork of allForksAfterAltair) {
    for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
      const topic = {type: GossipType.sync_committee, fork, subnet, encoding};
      const topicStr = stringifyGossipTopic(forkDigestContext, topic);
      const topicValidatorFn = validatorFnsByType[GossipType.sync_committee];
      validatorFnsByTopic.set(topicStr, topicValidatorFn);
      topicsByTopicStr.set(topicStr, topic);
    }
  }

  return {validatorFnsByTopic, topicsByTopicStr};
}
