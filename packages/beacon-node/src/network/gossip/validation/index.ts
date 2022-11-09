import {MessageAcceptance} from "@chainsafe/libp2p-gossipsub/types";
import {IChainForkConfig} from "@lodestar/config";
import {ILogger, mapValues} from "@lodestar/utils";
import {IMetrics} from "../../../metrics/index.js";
import {getGossipSSZType} from "../topic.js";
import {
  GossipJobQueues,
  GossipType,
  GossipValidatorFn,
  ValidatorFnsByType,
  GossipHandlers,
  GossipHandlerFn,
} from "../interface.js";
import {GossipActionError, GossipAction} from "../../../chain/errors/index.js";
import {createValidationQueues} from "./queue.js";

type ValidatorFnModules = {
  config: IChainForkConfig;
  logger: ILogger;
  metrics: IMetrics | null;
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
      return async function gossipValidatorFnWithQueue(topic, gossipMsg, propagationSource, seenTimestampSec) {
        return await jobQueue.push(topic, gossipMsg, propagationSource, seenTimestampSec);
      };
    }
  );

  return {jobQueues, validatorFnsByType};
}

/**
 * Returns a GossipSub validator function from a GossipHandlerFn. GossipHandlerFn may throw GossipActionError if one
 * or more validation conditions from the consensus-specs#p2p-interface are not satisfied.
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
  const {logger, metrics} = modules;

  return async function gossipValidatorFn(topic, msg, propagationSource, seenTimestampSec) {
    // Define in scope above try {} to be used in catch {} if object was parsed
    let gossipObject;
    try {
      // Deserialize object from bytes ONLY after being picked up from the validation queue
      try {
        const sszType = getGossipSSZType(topic);
        gossipObject = sszType.deserialize(msg.data);
      } catch (e) {
        // TODO: Log the error or do something better with it
        return MessageAcceptance.Reject;
      }

      await (gossipHandler as GossipHandlerFn)(gossipObject, topic, propagationSource, seenTimestampSec);

      metrics?.gossipValidationAccept.inc({topic: type});

      return MessageAcceptance.Accept;
    } catch (e) {
      if (!(e instanceof GossipActionError)) {
        // not deserve to log error here, it looks too dangerous to users
        logger.debug(`Gossip validation ${type} threw a non-GossipActionError`, {}, e as Error);
        return MessageAcceptance.Ignore;
      }

      // Metrics on specific error reason
      // Note: LodestarError.code are bounded pre-declared error messages, not from arbitrary error.message
      metrics?.gossipValidationError.inc({topic: type, error: (e as GossipActionError<{code: string}>).type.code});

      switch (e.action) {
        case GossipAction.IGNORE:
          metrics?.gossipValidationIgnore.inc({topic: type});
          return MessageAcceptance.Ignore;

        case GossipAction.REJECT:
          metrics?.gossipValidationReject.inc({topic: type});
          return MessageAcceptance.Reject;
      }
    }
  };
}
