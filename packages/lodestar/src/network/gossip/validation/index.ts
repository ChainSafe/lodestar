import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {Json} from "@chainsafe/ssz";
import {ILogger, mapValues} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../../metrics";
import {getGossipSSZType, GossipTopicCache} from "../topic";
import {GossipHandlers, GossipHandlerFn} from "../handlers";
import {GossipType, GossipValidatorFn, ValidatorFnsByType} from "../interface";
import {GossipValidationError} from "../errors";
import {GossipActionError, GossipAction} from "../../../chain/errors";
import {decodeMessageData, UncompressCache} from "../encoding";
import {wrapWithQueue} from "./queue";
import {DEFAULT_ENCODING} from "../constants";
import {getGossipAcceptMetadataByType, GetGossipAcceptMetadataFn} from "./onAccept";

type ValidatorFnModules = {
  config: IChainForkConfig;
  logger: ILogger;
  metrics: IMetrics | null;
  uncompressCache: UncompressCache;
  gossipTopicCache: GossipTopicCache;
};

/**
 * Returns GossipValidatorFn for each GossipType, given GossipHandlerFn indexed by type.
 *
 * @see getGossipHandlers for reasoning on why GossipHandlerFn are used for gossip validation.
 */
export function createValidatorFnsByType(
  gossipHandlers: GossipHandlers,
  modules: ValidatorFnModules & {signal: AbortSignal}
): ValidatorFnsByType {
  return mapValues(gossipHandlers, (gossipHandler, type) => {
    const gossipValidatorFn = getGossipValidatorFn(gossipHandler, type, modules);

    return wrapWithQueue(gossipValidatorFn, type, modules.signal, modules.metrics);
  });
}

/**
 * Returns a GossipSub validator function from a GossipHandlerFn. GossipHandlerFn may throw GossipActionError if one
 * or more validation conditions from the eth2.0-specs#p2p-interface are not satisfied.
 *
 * This function receives a string topic and a binary message `InMessage` and deserializes both using caches.
 * - The topic string should be known in advance and pre-computed
 * - The message.data should already by uncompressed when computing its msgID
 *
 * All logging and metrics associated with gossip object validation should happen in this function. We want to know
 * - In debug logs what objects are we processing, the result and some succint metadata
 * - In metrics what's the throughput and ratio of accept/ignore/reject per type
 *
 * @see getGossipHandlers for reasoning on why GossipHandlerFn are used for gossip validation.
 */
function getGossipValidatorFn<K extends GossipType>(
  gossipHandler: GossipHandlers[K],
  type: K,
  modules: ValidatorFnModules
): GossipValidatorFn {
  const {config, logger, metrics, uncompressCache, gossipTopicCache} = modules;
  const getGossipObjectAcceptMetadata = getGossipAcceptMetadataByType[type] as GetGossipAcceptMetadataFn;

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

      await (gossipHandler as GossipHandlerFn)(gossipObject, topic);

      const metadata = getGossipObjectAcceptMetadata(config, gossipObject, topic);
      logger.debug(`gossip - ${type} - accept`, metadata);
      metrics?.gossipValidationAccept.inc({topic: type}, 1);
    } catch (e) {
      if (!(e instanceof GossipActionError)) {
        logger.error(`Gossip validation ${type} threw a non-GossipActionError`, {}, e);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE, (e as Error).message);
      }

      switch (e.action) {
        case GossipAction.IGNORE:
          logger.debug(`gossip - ${type} - ignore`, e.type as Json);
          metrics?.gossipValidationIgnore.inc({topic: type}, 1);
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE, e.message);

        case GossipAction.REJECT:
          logger.debug(`gossip - ${type} - reject`, e.type as Json);
          metrics?.gossipValidationReject.inc({topic: type}, 1);
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, e.message);
      }
    }
  };
}
