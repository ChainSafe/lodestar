import {AbortSignal} from "@chainsafe/abort-controller";
import {ATTESTATION_SUBNET_COUNT, ForkName, SYNC_COMMITTEE_SUBNET_COUNT} from "@chainsafe/lodestar-params";
import {mapValues} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics";
import {JobQueue, JobQueueOpts, QueueType} from "../../util/queue";
import {stringifyGossipTopic} from "./topic";
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
const gossipQueueOpts: {[K in GossipType]: Pick<JobQueueOpts, "maxLength" | "type" | "maxConcurrency">} = {
  [GossipType.beacon_block]: {maxLength: 1024, type: QueueType.FIFO},
  // this is different from lighthouse's, there are more gossip aggregate_and_proof than gossip block
  [GossipType.beacon_aggregate_and_proof]: {maxLength: 4096, type: QueueType.LIFO, maxConcurrency: 16},
  [GossipType.beacon_attestation]: {maxLength: 16384, type: QueueType.LIFO, maxConcurrency: 64},
  [GossipType.voluntary_exit]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.proposer_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.attester_slashing]: {maxLength: 4096, type: QueueType.FIFO},
  [GossipType.sync_committee_contribution_and_proof]: {maxLength: 4096, type: QueueType.LIFO},
  [GossipType.sync_committee]: {maxLength: 4096, type: QueueType.LIFO},
};

export function createTopicValidatorFnMap(
  modules: IObjectValidatorModules,
  metrics: IMetrics | null,
  signal: AbortSignal
): TopicValidatorFnMap {
  const wrappedValidatorFns = mapValues(validatorFns, (validatorFn, type) =>
    wrapWithQueue(validatorFn as ValidatorFn<typeof type>, modules, {signal, ...gossipQueueOpts[type]}, metrics, type)
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
  metrics: IMetrics | null,
  type: GossipType
): TopicValidatorFn {
  const jobQueue = new JobQueue(
    queueOpts,
    metrics
      ? {
          length: metrics.gossipValidationQueueLength.child({topic: type}),
          droppedJobs: metrics.gossipValidationQueueDroppedJobs.child({topic: type}),
          jobTime: metrics.gossipValidationQueueJobTime.child({topic: type}),
          jobWaitTime: metrics.gossipValidationQueueJobWaitTime.child({topic: type}),
        }
      : undefined
  );
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
  // static topics
  const staticGossipTypesPhase0: GossipType[] = [
    GossipType.beacon_block,
    GossipType.beacon_aggregate_and_proof,
    GossipType.voluntary_exit,
    GossipType.proposer_slashing,
    GossipType.attester_slashing,
  ];
  const staticGossipTypesAltair: GossipType[] = [GossipType.sync_committee_contribution_and_proof];
  const staticGossipTypesByFork = {
    [ForkName.phase0]: staticGossipTypesPhase0,
    [ForkName.altair]: staticGossipTypesAltair,
  };

  for (const fork of [ForkName.phase0, ForkName.altair]) {
    const staticGossipTypes = staticGossipTypesByFork[fork];
    for (const type of staticGossipTypes) {
      const topic = {type, fork, encoding: DEFAULT_ENCODING} as GossipTopic;
      const topicString = stringifyGossipTopic(modules.chain.forkDigestContext, topic);
      validatorFnsByTopic.set(topicString, validatorFnsByType[type]);
    }
  }

  // dynamic topics
  // phase0
  let fork = ForkName.phase0;
  // create an entry for every committee subnet - phase0
  for (let subnet = 0; subnet < ATTESTATION_SUBNET_COUNT; subnet++) {
    const topic = {
      type: GossipType.beacon_attestation,
      fork,
      encoding: DEFAULT_ENCODING,
      subnet,
    } as GossipTopic;
    const topicString = stringifyGossipTopic(modules.chain.forkDigestContext, topic);
    const topicValidatorFn = validatorFnsByType[GossipType.beacon_attestation];
    validatorFnsByTopic.set(topicString, topicValidatorFn);
  }
  // altair
  fork = ForkName.altair;
  for (let subnet = 0; subnet < SYNC_COMMITTEE_SUBNET_COUNT; subnet++) {
    const topic = {
      type: GossipType.sync_committee,
      fork,
      encoding: DEFAULT_ENCODING,
      subnet,
    } as GossipTopic;
    const topicString = stringifyGossipTopic(modules.chain.forkDigestContext, topic);
    const topicValidatorFn = validatorFnsByType[GossipType.sync_committee];
    validatorFnsByTopic.set(topicString, topicValidatorFn);
  }

  return validatorFnsByTopic;
}
