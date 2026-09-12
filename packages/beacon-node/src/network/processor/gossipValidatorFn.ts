import {TopicValidatorResult} from "@libp2p/gossipsub";
import {ChainForkConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {AttestationError, GossipAction, GossipActionError} from "../../chain/errors/index.js";
import {Metrics} from "../../metrics/index.js";
import {INetworkCore} from "../core/index.js";
import {
  BatchGossipHandlerFn,
  GossipHandlerFn,
  GossipHandlers,
  GossipMessageInfo,
  GossipType,
  GossipValidatorBatchFn,
  GossipValidatorFn,
} from "../gossip/interface.js";
import {PeerAction} from "../peers/index.js";
import {prettyPrintPeerIdStr} from "../util.js";

export type ValidatorFnModules = {
  config: ChainForkConfig;
  logger: Logger;
  metrics: Metrics | null;
  core: INetworkCore;
};

/**
 * Critical topics (the `bypassQueue` set in
 * `processor/index.ts`) are penalized heavily; the rest with mid tolerance.
 */
const gossipRejectPeerAction: Record<GossipType, PeerAction> = {
  [GossipType.beacon_block]: PeerAction.LowToleranceError,
  [GossipType.blob_sidecar]: PeerAction.LowToleranceError,
  [GossipType.data_column_sidecar]: PeerAction.LowToleranceError,
  [GossipType.execution_payload]: PeerAction.LowToleranceError,
  [GossipType.beacon_aggregate_and_proof]: PeerAction.MidToleranceError,
  [GossipType.beacon_attestation]: PeerAction.MidToleranceError,
  [GossipType.voluntary_exit]: PeerAction.MidToleranceError,
  [GossipType.proposer_slashing]: PeerAction.MidToleranceError,
  [GossipType.attester_slashing]: PeerAction.MidToleranceError,
  [GossipType.sync_committee_contribution_and_proof]: PeerAction.MidToleranceError,
  [GossipType.sync_committee]: PeerAction.MidToleranceError,
  [GossipType.light_client_finality_update]: PeerAction.MidToleranceError,
  [GossipType.light_client_optimistic_update]: PeerAction.MidToleranceError,
  [GossipType.bls_to_execution_change]: PeerAction.MidToleranceError,
  [GossipType.payload_attestation_message]: PeerAction.MidToleranceError,
  [GossipType.execution_payload_bid]: PeerAction.MidToleranceError,
  [GossipType.proposer_preferences]: PeerAction.MidToleranceError,
};

/**
 * Similar to getGossipValidatorFn but return a function to accept a batch of beacon_attestation messages
 * with the same attestation data
 */
export function getGossipValidatorBatchFn(
  gossipHandlers: GossipHandlers,
  modules: ValidatorFnModules
): GossipValidatorBatchFn {
  const {logger, metrics, core} = modules;

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

      return results.map((e, i) => {
        if (e == null) {
          return TopicValidatorResult.Accept;
        }

        const {clientAgent, clientVersion, propagationSource} = messageInfos[i];

        if (!(e instanceof AttestationError)) {
          logger.debug(
            `Gossip batch validation ${type} threw a non-AttestationError`,
            {peerId: prettyPrintPeerIdStr(propagationSource), clientAgent, clientVersion},
            e as Error
          );
          metrics?.networkProcessor.gossipValidationIgnore.inc({topic: type});
          return TopicValidatorResult.Ignore;
        }

        switch (e.action) {
          case GossipAction.IGNORE:
            metrics?.networkProcessor.gossipValidationIgnore.inc({topic: type});
            // only beacon_attestation topic is validated in batch
            metrics?.networkProcessor.gossipAttestationIgnoreByReason.inc({reason: e.type.code});
            return TopicValidatorResult.Ignore;
          case GossipAction.REJECT:
            metrics?.networkProcessor.gossipValidationReject.inc({topic: type});
            // only beacon_attestation topic is validated in batch
            metrics?.networkProcessor.gossipAttestationRejectByReason.inc({reason: e.type.code});
            core.reportPeer(propagationSource, gossipRejectPeerAction[type], e.type.code);
            logger.debug(
              `Gossip validation ${type} rejected`,
              {peer: propagationSource, clientAgent, clientVersion},
              e
            );
            return TopicValidatorResult.Reject;
        }
      });
    } catch (e) {
      // Don't expect error here
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
  const {logger, metrics, core} = modules;

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

    try {
      await (gossipHandlers[type] as GossipHandlerFn)({
        gossipData: {serializedData: msg.data, msgSlot},
        topic,
        peerIdStr: propagationSource,
        seenTimestampSec,
      });

      metrics?.networkProcessor.gossipValidationAccept.inc({topic: type});

      return TopicValidatorResult.Accept;
    } catch (e) {
      if (!(e instanceof GossipActionError)) {
        // not deserve to log error here, it looks too dangerous to users
        logger.debug(
          `Gossip validation ${type} threw a non-GossipActionError`,
          {peerId: prettyPrintPeerIdStr(propagationSource), clientAgent, clientVersion},
          e as Error
        );
        return TopicValidatorResult.Ignore;
      }

      // Metrics on specific error reason
      // Note: LodestarError.code are bounded pre-declared error messages, not from arbitrary error.message
      metrics?.networkProcessor.gossipValidationError.inc({
        topic: type,
        error: (e as GossipActionError<{code: string}>).type.code,
      });

      switch (e.action) {
        case GossipAction.IGNORE:
          metrics?.networkProcessor.gossipValidationIgnore.inc({topic: type});
          return TopicValidatorResult.Ignore;

        case GossipAction.REJECT:
          metrics?.networkProcessor.gossipValidationReject.inc({topic: type});
          core.reportPeer(propagationSource, gossipRejectPeerAction[type], e.type.code);
          logger.debug(`Gossip validation ${type} rejected`, {peer: propagationSource, clientAgent, clientVersion}, e);
          return TopicValidatorResult.Reject;
      }
    }
  };
}
