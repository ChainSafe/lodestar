import {AbortSignal} from "@chainsafe/abort-controller";
import {ATTESTATION_SUBNET_COUNT, ForkName} from "@chainsafe/lodestar-params";
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
  GossipTopicTypeMap,
} from "./interface";
import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {GossipValidationError} from "./errors";
import {GossipActionError, GossipAction} from "../../chain/errors";
import {Json, toHexString} from "@chainsafe/ssz";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

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
  const {logger, config} = modules;
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
    await jobQueue.push(async () => {
      try {
        await validatorFn(modules, gossipTopic, gossipObject);

        const metadata = getGossipObjectAcceptMetadataObj[type](config, gossipObject as any, gossipTopic as any);
        logger.debug(`gossip - ${type} - accept`, metadata);
        metrics?.gossipValidationAccept.inc({topic: type}, 1);
      } catch (e) {
        if (!(e instanceof GossipActionError)) {
          logger.error(`Gossip validation ${type} threw a non-GossipValidationError`, {}, e);
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);
        }

        switch (e.action) {
          case GossipAction.IGNORE:
            logger.debug(`gossip - ${type} - ignore`, e.type as Json);
            metrics?.gossipValidationIgnore.inc({topic: type}, 1);
            throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE);

          case GossipAction.REJECT:
            logger.debug(`gossip - ${type} - reject`, e.type as Json);
            metrics?.gossipValidationReject.inc({topic: type}, 1);
            throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT);
        }
      }
    });
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
  const staticGossipTypes: GossipType[] = [
    GossipType.beacon_block,
    GossipType.beacon_aggregate_and_proof,
    GossipType.voluntary_exit,
    GossipType.proposer_slashing,
    GossipType.attester_slashing,
  ];

  // TODO: other fork topics should get added here
  // phase0
  const fork = ForkName.phase0;

  for (const type of staticGossipTypes) {
    const topic = {type, fork, encoding: DEFAULT_ENCODING} as GossipTopic;
    const topicString = stringifyGossipTopic(modules.chain.forkDigestContext, topic);
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
    const topicString = stringifyGossipTopic(modules.chain.forkDigestContext, topic);
    const topicValidatorFn = validatorFnsByType[GossipType.beacon_attestation];
    validatorFnsByTopic.set(topicString, topicValidatorFn);
  }

  return validatorFnsByTopic;
}

/**
 * Return succint but meaningful data about accepted gossip objects
 */
const getGossipObjectAcceptMetadataObj: {
  [K in GossipType]: (config: IBeaconConfig, object: GossipTypeMap[K], topic: GossipTopicTypeMap[K]) => Json;
} = {
  [GossipType.beacon_block]: (config, signedBlock) => ({
    slot: signedBlock.message.slot,
    root: toHexString(config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message)),
  }),
  [GossipType.beacon_aggregate_and_proof]: (config, aggregateAndProof) => {
    const {data} = aggregateAndProof.message.aggregate;
    return {
      slot: data.slot,
      index: data.index,
    };
  },
  [GossipType.beacon_attestation]: (config, attestation, topic) => ({
    slot: attestation.data.slot,
    subnet: topic.subnet,
    index: attestation.data.index,
  }),
  [GossipType.voluntary_exit]: (config, voluntaryExit) => ({
    validatorIndex: voluntaryExit.message.validatorIndex,
  }),
  [GossipType.proposer_slashing]: (config, proposerSlashing) => ({
    proposerIndex: proposerSlashing.signedHeader1.message.proposerIndex,
  }),
  [GossipType.attester_slashing]: (config, attesterSlashing) => ({
    slot1: attesterSlashing.attestation1.data.slot,
    slot2: attesterSlashing.attestation2.data.slot,
  }),
  [GossipType.sync_committee_contribution_and_proof]: (config, contributionAndProof) => {
    const {contribution} = contributionAndProof.message;
    return {
      slot: contribution.slot,
      index: contribution.subCommitteeIndex,
    };
  },
  [GossipType.sync_committee]: (config, syncCommitteeSignature, topic) => ({
    slot: syncCommitteeSignature.slot,
    subnet: topic.subnet,
  }),
};
