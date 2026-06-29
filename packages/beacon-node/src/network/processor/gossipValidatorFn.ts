import {TopicValidatorResult} from "@libp2p/gossipsub";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {GossipValidationStatus, GossipValidationVerdict} from "../../chain/beaconEngine/gossipValidationResult.js";
import {AttestationErrorCode} from "../../chain/errors/index.js";
import {Metrics} from "../../metrics/index.js";
import {
  BatchGossipHandlerFn,
  GossipHandlerFn,
  GossipHandlers,
  GossipMessageInfo,
  GossipValidatorBatchFn,
  GossipValidatorFn,
} from "../gossip/interface.js";
import {prettyPrintPeerIdStr} from "../util.js";

export type ValidatorFnModules = {
  config: ChainForkConfig;
  logger: Logger;
  metrics: Metrics | null;
};

/**
 * Similar to getGossipValidatorFn but return a function to accept a batch of beacon_attestation messages
 * with the same attestation data
 */
export function getGossipValidatorBatchFn(
  gossipHandlers: GossipHandlers,
  modules: ValidatorFnModules
): GossipValidatorBatchFn {
  const {logger, metrics} = modules;

  return async function gossipValidatorBatchFn(messageInfos: GossipMessageInfo[]) {
    // all messageInfos have same topic type
    const type = messageInfos[0].topic.type;
    try {
      const results = await (gossipHandlers[type] as BatchGossipHandlerFn)(
        messageInfos.map((messageInfo) => ({
          gossipData: {
            serializedData: messageInfo.msg.data,
            msgSlot: messageInfo.msgSlot,
            indexed: messageInfo.indexed,
          },
          topic: messageInfo.topic,
          peerIdStr: messageInfo.propagationSource,
          seenTimestampSec: messageInfo.seenTimestampSec,
        }))
      );

      return results.map((res, i): TopicValidatorResult => {
        if (res.status === GossipValidationStatus.Accept) {
          return TopicValidatorResult.Accept;
        }

        const {clientAgent, clientVersion, propagationSource} = messageInfos[i];

        switch (res.status) {
          case GossipValidationStatus.Ignore:
            metrics?.networkProcessor.gossipValidationIgnore.inc({topic: type});
            // only beacon_attestation topic is validated in batch
            metrics?.networkProcessor.gossipAttestationIgnoreByReason.inc({reason: res.code as AttestationErrorCode});
            return TopicValidatorResult.Ignore;
          case GossipValidationStatus.Reject:
            metrics?.networkProcessor.gossipValidationReject.inc({topic: type});
            // only beacon_attestation topic is validated in batch
            metrics?.networkProcessor.gossipAttestationRejectByReason.inc({reason: res.code as AttestationErrorCode});
            logger.debug(
              `Gossip validation ${type} rejected`,
              {peerId: prettyPrintPeerIdStr(propagationSource), clientAgent, clientVersion},
              res.error
            );
            return TopicValidatorResult.Reject;
        }
      });
    } catch (e) {
      // Handlers return a verdict per message and no longer throw on validation failure, so this is only a
      // safety net for an unexpected throw (handler bug). Map the whole batch to Ignore as before.
      logger.debug(`Gossip batch validation ${type} threw an error`, {}, e as Error);
      const results: TopicValidatorResult[] = [];
      for (let i = 0; i < messageInfos.length; i++) {
        results.push(TopicValidatorResult.Ignore);
      }
      return results;
    }
  };
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
export function getGossipValidatorFn(gossipHandlers: GossipHandlers, modules: ValidatorFnModules): GossipValidatorFn {
  const {logger, metrics} = modules;

  return async function gossipValidatorFn({
    topic,
    msg,
    propagationSource,
    clientAgent,
    clientVersion,
    seenTimestampSec,
    msgSlot,
  }) {
    const type = topic.type;

    let result: GossipValidationVerdict;
    try {
      result = await (gossipHandlers[type] as GossipHandlerFn)({
        gossipData: {serializedData: msg.data, msgSlot},
        topic,
        peerIdStr: propagationSource,
        seenTimestampSec,
      });
    } catch (e) {
      // Handlers should not throw — they return a verdict. An unexpected throw maps to Ignore (mirrors the
      // previous "non-GossipActionError → Ignore" behavior). Not logged as error: too noisy/dangerous.
      logger.debug(
        `Gossip validation ${type} threw an unexpected error`,
        {peerId: prettyPrintPeerIdStr(propagationSource), clientAgent, clientVersion},
        e as Error
      );
      return TopicValidatorResult.Ignore;
    }

    switch (result.status) {
      case GossipValidationStatus.Accept:
        metrics?.networkProcessor.gossipValidationAccept.inc({topic: type});
        return TopicValidatorResult.Accept;

      case GossipValidationStatus.Ignore:
        // Note: LodestarError.code are bounded pre-declared error messages, not from arbitrary error.message
        metrics?.networkProcessor.gossipValidationError.inc({topic: type, error: result.code});
        metrics?.networkProcessor.gossipValidationIgnore.inc({topic: type});
        return TopicValidatorResult.Ignore;

      case GossipValidationStatus.Reject:
        metrics?.networkProcessor.gossipValidationError.inc({topic: type, error: result.code});
        metrics?.networkProcessor.gossipValidationReject.inc({topic: type});
        logger.debug(
          `Gossip validation ${type} rejected`,
          {peerId: prettyPrintPeerIdStr(propagationSource), clientAgent, clientVersion},
          result.error
        );
        return TopicValidatorResult.Reject;
    }
  };
}
