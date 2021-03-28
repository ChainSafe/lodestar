import {AbortSignal} from "abort-controller";
import {ATTESTATION_SUBNET_COUNT} from "@chainsafe/lodestar-types";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IBeaconMetrics} from "../../metrics";
import {JobQueue, JobQueueOpts, QueueType} from "../../util/queue";
import {getGossipTopicString} from "./topic";
import {DEFAULT_ENCODING} from "./constants";
import {validatorFns} from "./validatorFns";
import {parseGossipMsg} from "./message";
import {
  GossipType,
  TopicValidatorFn,
  IObjectValidatorModules,
  GossipTopic,
  TopicValidatorFnMap,
  GossipTopicMap,
  GossipTypeMap,
} from "./interface";

// Numbers from https://github.com/sigp/lighthouse/blob/b34a79dc0b02e04441ba01fd0f304d1e203d877d/beacon_node/network/src/beacon_processor/mod.rs#L69
const gossipQueueOpts: {[K in GossipType]: {maxLength: number; type: QueueType}} = {
  [GossipType.beacon_block]: {maxLength: 1024, type: QueueType.FIFO},
  [GossipType.beacon_aggregate_and_proof]: {maxLength: 1024, type: QueueType.LIFO},
  [GossipType.beacon_attestation]: {maxLength: 16384, type: QueueType.LIFO},
  [GossipType.voluntary_exit]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.proposer_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.attester_slashing]: {maxLength: 4096, type: QueueType.FIFO},
};

const gossipMetricsPrefix: {[K in GossipType]: string} = {
  [GossipType.beacon_block]: "lodestar_gossip_beacon_block_queue",
  [GossipType.beacon_aggregate_and_proof]: "lodestar_gossip_beacon_aggregate_and_proof_queue",
  [GossipType.beacon_attestation]: "lodestar_gossip_beacon_attestation_queue",
  [GossipType.voluntary_exit]: "lodestar_gossip_voluntary_exit_queue",
  [GossipType.proposer_slashing]: "lodestar_gossip_proposer_slashing_queue",
  [GossipType.attester_slashing]: "lodestar_gossip_attester_slashing_queue",
};

export function createTopicValidatorFnMap(
  modules: IObjectValidatorModules,
  metrics: IBeaconMetrics | undefined,
  signal: AbortSignal
): TopicValidatorFnMap {
  const wrappedValidatorFns = mapValues(validatorFns, (validatorFn, type) =>
    wrapWithQueue(
      validatorFn as ValidatorFn<typeof type>,
      modules,
      {signal, ...gossipQueueOpts[type]},
      metrics,
      gossipMetricsPrefix[type]
    )
  );

  return createValidatorFnsByTopic(modules, wrappedValidatorFns);
}

/**
 * Intermediate type for gossip validation functions.
 * Gossip validation functions defined with this signature are easier to unit test
 */
export type ValidatorFn<K extends GossipType> = (
  modules: IObjectValidatorModules,
  topic: GossipTopicMap[K],
  object: GossipTypeMap[K]
) => Promise<void>;

/**
 * Wraps an ObjectValidatorFn as a TopicValidatorFn
 * See TopicValidatorFn here https://github.com/libp2p/js-libp2p-interfaces/blob/v0.5.2/src/pubsub/index.js#L529
 */
export function wrapWithQueue<K extends GossipType>(
  validatorFn: ValidatorFn<K>,
  modules: IObjectValidatorModules,
  queueOpts: JobQueueOpts,
  metrics: IBeaconMetrics | undefined,
  metricsPrefix: string
): TopicValidatorFn {
  const jobQueue = new JobQueue(queueOpts, {metrics, prefix: metricsPrefix});
  return async function (_topicStr, gossipMsg) {
    const {gossipTopic, gossipObject} = parseGossipMsg<K>(gossipMsg);
    await jobQueue.push(async () => await validatorFn(modules, gossipTopic, gossipObject));
  };
}

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
  modules: IObjectValidatorModules,
  validatorFnsByType: {[K in GossipType]: TopicValidatorFn}
): TopicValidatorFnMap {
  const validatorFnsByTopic = new Map<string, TopicValidatorFn>();
  const genesisValidatorsRoot = modules.chain.genesisValidatorsRoot;

  const staticGossipTypes: GossipType[] = [
    GossipType.beacon_block,
    GossipType.beacon_aggregate_and_proof,
    GossipType.voluntary_exit,
    GossipType.proposer_slashing,
    GossipType.attester_slashing,
  ];

  // TODO: other fork topics should get added here
  // phase0
  const fork = "phase0";

  for (const type of staticGossipTypes) {
    const topic = {type, fork, encoding: DEFAULT_ENCODING} as GossipTopic;
    const topicString = getGossipTopicString(modules.config, topic, genesisValidatorsRoot);
    validatorFnsByTopic.set(topicString, validatorFnsByType[type]);
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
    const topicValidatorFn = validatorFnsByType[GossipType.beacon_attestation];
    validatorFnsByTopic.set(topicString, topicValidatorFn);
  }

  return validatorFnsByTopic;
}
