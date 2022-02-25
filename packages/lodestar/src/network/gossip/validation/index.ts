import {ERR_TOPIC_VALIDATOR_IGNORE, ERR_TOPIC_VALIDATOR_REJECT} from "libp2p-gossipsub/src/constants";
import {AbortSignal} from "@chainsafe/abort-controller";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {ILogger, mapValues} from "@chainsafe/lodestar-utils";
import {IMetrics} from "../../../metrics";
import {getGossipSSZType} from "../topic";
import {
  GossipJobQueues,
  GossipType,
  GossipValidatorFn,
  ValidatorFnsByType,
  GossipHandlers,
  GossipHandlerFn,
} from "../interface";
import {GossipValidationError} from "../errors";
import {GossipActionError, GossipAction} from "../../../chain/errors";
import {decodeMessageData, UncompressCache} from "../encoding";
import {createValidationQueues} from "./queue";
import {DEFAULT_ENCODING} from "../constants";
import {getGossipAcceptMetadataByType, GetGossipAcceptMetadataFn} from "./onAccept";
import {IPeerRpcScoreStore, PeerAction} from "../../peers/score";
import PeerId from "peer-id";

type ValidatorFnModules = {
  config: IChainForkConfig;
  logger: ILogger;
  peerRpcScores: IPeerRpcScoreStore;
  metrics: IMetrics | null;
  uncompressCache: UncompressCache;
};

/**
 * Returns GossipValidatorFn for each GossipType, given GossipHandlerFn indexed by type.
 *
 * @see getGossipHandlers for reasoning on why GossipHandlerFn are used for gossip validation.
 */
export function createValidatorFnsByType(
  gossipHandlers: GossipHandlers,
  modules: ValidatorFnModules & {signal: AbortSignal}
): {validatorFnsByType: ValidatorFnsByType; jobQueues: GossipJobQueues} {
  const gossipValidatorFns = mapValues(gossipHandlers, (gossipHandler, type) => {
    return getGossipValidatorFn(gossipHandler, type, modules);
  });

  const jobQueues = createValidationQueues(gossipValidatorFns, modules.signal, modules.metrics);

  const validatorFnsByType = mapValues(
    jobQueues,
    (jobQueue): GossipValidatorFn => {
      return async function gossipValidatorFnWithQueue(topic, gossipMsg, seenTimestampsMs) {
        await jobQueue.push(topic, gossipMsg, seenTimestampsMs);
      };
    }
  );

  return {jobQueues, validatorFnsByType};
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
  const {config, logger, metrics, uncompressCache} = modules;
  const getGossipObjectAcceptMetadata = getGossipAcceptMetadataByType[type] as GetGossipAcceptMetadataFn;

  return async function gossipValidatorFn(topic, gossipMsg, seenTimestampSec) {
    // Define in scope above try {} to be used in catch {} if object was parsed
    let gossipObject;
    const {data, receivedFrom} = gossipMsg;
    try {
      const encoding = topic.encoding ?? DEFAULT_ENCODING;

      // Deserialize object from bytes ONLY after being picked up from the validation queue
      try {
        const sszType = getGossipSSZType(topic);
        const messageData = decodeMessageData(encoding, data, uncompressCache);
        gossipObject =
          // TODO: Review if it's really necessary to deserialize this as TreeBacked
          topic.type === GossipType.beacon_block || topic.type === GossipType.beacon_aggregate_and_proof
            ? sszType.createTreeBackedFromBytes(messageData)
            : sszType.deserialize(messageData);
      } catch (e) {
        // TODO: Log the error or do something better with it
        throw new GossipActionError(GossipAction.REJECT, PeerAction.LowToleranceError, {code: (e as Error).message});
      }

      await (gossipHandler as GossipHandlerFn)(gossipObject, topic, receivedFrom, seenTimestampSec);

      const metadata = getGossipObjectAcceptMetadata(config, gossipObject, topic);
      logger.debug(`gossip - ${type} - accept`, metadata);
      metrics?.gossipValidationAccept.inc({topic: type});
    } catch (e) {
      if (!(e instanceof GossipActionError)) {
        logger.error(`Gossip validation ${type} threw a non-GossipActionError`, {}, e as Error);
        throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE, (e as Error).message);
      }

      if (e.lodestarAction) {
        modules.peerRpcScores.applyAction(PeerId.createFromB58String(receivedFrom), e.lodestarAction);
      }

      // If the gossipObject was deserialized include its short metadata with the error data
      const metadata = gossipObject && getGossipObjectAcceptMetadata(config, gossipObject, topic);
      const errorData = {...metadata, ...e.getMetadata()};

      switch (e.action) {
        case GossipAction.IGNORE:
          logger.debug(`gossip - ${type} - ignore`, errorData);
          metrics?.gossipValidationIgnore.inc({topic: type});
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_IGNORE, e.message);

        case GossipAction.REJECT:
          logger.debug(`gossip - ${type} - reject`, errorData);
          metrics?.gossipValidationReject.inc({topic: type});
          throw new GossipValidationError(ERR_TOPIC_VALIDATOR_REJECT, e.message);
      }
    }
  };
}
