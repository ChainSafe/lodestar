import {ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-types";
import {
  GossipType,
  IGossipMessage,
  TopicValidatorFn,
  ObjectValidatorFn,
  IObjectValidatorModules,
  GossipTopic,
} from "./interface";
import {getGossipTopicString} from "./topic";
import {GossipValidationError} from "./errors";
import {DEFAULT_ENCODING} from "./constants";
import {objectValidatorFns} from "./validatorFns";

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

/**
 * Wrap an ObjectValidatorFn as a TopicValidatorFn
 *
 * See TopicValidatorFn here https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L529
 */
export function createTopicValidatorFn(
  modules: IObjectValidatorModules,
  objectValidatorFn: ObjectValidatorFn
): TopicValidatorFn {
  return async (topicString: string, msg: IGossipMessage): Promise<void> => {
    const gossipTopic = msg.gossipTopic;
    const gossipObject = msg.gossipObject;
    if (gossipTopic == null || gossipObject == null) {
      throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
    }
    await objectValidatorFn(modules, gossipTopic, gossipObject);
  };
}

export function createTopicValidatorFnMap(modules: IObjectValidatorModules): Map<string, TopicValidatorFn> {
  const validatorFns = new Map<string, TopicValidatorFn>();
  const genesisValidatorsRoot = modules.chain.genesisValidatorsRoot;

  // TODO: other fork topics should get added here
  // phase0
  const fork = "phase0";
  const staticGossipTypes: GossipType[] = [
    GossipType.beacon_block,
    GossipType.beacon_aggregate_and_proof,
    GossipType.voluntary_exit,
    GossipType.proposer_slashing,
    GossipType.attester_slashing,
  ];

  for (const type of staticGossipTypes) {
    const objectValidatorFn = objectValidatorFns[type];
    const topic = {type, fork, encoding: DEFAULT_ENCODING} as GossipTopic;
    const topicString = getGossipTopicString(modules.config, topic, genesisValidatorsRoot);
    const topicValidatorFn = createTopicValidatorFn(modules, objectValidatorFn as ObjectValidatorFn);
    validatorFns.set(topicString, topicValidatorFn);
  }
  // create an entry for every committee subnet - phase0
  for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
    const topic = {
      type: GossipType.beacon_attestation,
      fork,
      encoding: DEFAULT_ENCODING,
      subnet,
    } as GossipTopic;
    const topicString = getGossipTopicString(modules.config, topic, genesisValidatorsRoot);
    const topicValidatorFn = createTopicValidatorFn(
      modules,
      objectValidatorFns[GossipType.beacon_attestation] as ObjectValidatorFn
    );
    validatorFns.set(topicString, topicValidatorFn);
  }
  return validatorFns;
}
