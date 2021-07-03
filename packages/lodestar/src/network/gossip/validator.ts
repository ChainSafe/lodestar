import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Json, toHexString} from "@chainsafe/ssz";
import {ILogger, mapValues} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../metrics";
import {getGossipSSZType, GossipTopicCache} from "./topic";
import {GossipValidatorFns, GossipValidatorFn} from "./validation/validatorFns";
import {GossipType, TopicValidatorFn, ValidatorFnsByType, GossipTypeMap, GossipTopicTypeMap} from "./interface";
import {GossipValidationError} from "./errors";
import {GossipActionError, GossipAction} from "../../chain/errors";
import {decodeMessageData, UncompressCache} from "./encoding";
import {wrapWithQueue} from "./validation/queue";
import {DEFAULT_ENCODING} from "./constants";

export function createValidatorFnsByType(
  validatorFns: GossipValidatorFns,
  config: IBeaconConfig,
  logger: ILogger,
  uncompressCache: UncompressCache,
  gossipTopicCache: GossipTopicCache,
  metrics: IMetrics | null,
  signal: AbortSignal
): ValidatorFnsByType {
  return mapValues(validatorFns, (validatorFn, type) => {
    const gossipMessageHandler = getGossipMessageHandler(
      validatorFn,
      type,
      config,
      logger,
      metrics,
      uncompressCache,
      gossipTopicCache
    );

    return wrapWithQueue(gossipMessageHandler, type, signal, metrics);
  });
}

function getGossipMessageHandler<K extends GossipType>(
  validatorFn: GossipValidatorFns[K],
  type: K,
  config: IBeaconConfig,
  logger: ILogger,
  metrics: IMetrics | null,
  uncompressCache: UncompressCache,
  gossipTopicCache: GossipTopicCache
): TopicValidatorFn {
  const getGossipObjectAcceptMetadata = getGossipObjectAcceptMetadataObj[type] as GetGossipAcceptMetadataFn;

  return async function (topicStr, gossipMsg) {
    try {
      const topic = gossipTopicCache.getTopic(topicStr);
      const encoding = topic.encoding ?? DEFAULT_ENCODING;

      // Deserialize object from bytes ONLY after being picked up from the validation queue
      let gossipObject;
      try {
        const sszType = getGossipSSZType(topic);
        const messageData = decodeMessageData(encoding, gossipMsg.data, uncompressCache);
        gossipObject =
          // TODO: Review if it's really necessary to deserialize this as TreeBacked
          topic.type === GossipType.beacon_block || topic.type === GossipType.beacon_aggregate_and_proof
            ? sszType.createTreeBackedFromBytes(messageData)
            : sszType.deserialize(messageData);
      } catch (e) {
        // TODO: Log the error or do something better with it
        throw new GossipActionError(GossipAction.REJECT, {code: (e as Error).message});
      }

      await (validatorFn as GossipValidatorFn)(gossipObject, topic);

      const metadata = getGossipObjectAcceptMetadata(config, gossipObject, topic);
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
  };
}

type GetGossipAcceptMetadataFn = (
  config: IBeaconConfig,
  object: GossipTypeMap[GossipType],
  topic: GossipTopicTypeMap[GossipType]
) => Json;
type GetGossipAcceptMetadataFns = {
  [K in GossipType]: (config: IBeaconConfig, object: GossipTypeMap[K], topic: GossipTopicTypeMap[K]) => Json;
};

/**
 * Return succint but meaningful data about accepted gossip objects
 */
const getGossipObjectAcceptMetadataObj: GetGossipAcceptMetadataFns = {
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
