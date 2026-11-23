import {TopicValidatorResult} from "@libp2p/gossipsub";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {
  AttestationError,
  AttestationErrorCode,
  AttesterSlashingErrorCode,
  BlobSidecarErrorCode,
  BlockErrorCode,
  BlsToExecutionChangeErrorCode,
  DataColumnSidecarErrorCode,
  ExecutionPayloadBidErrorCode,
  ExecutionPayloadEnvelopeErrorCode,
  GossipAction,
  GossipActionError,
  InclusionListErrorCode,
  PayloadAttestationErrorCode,
  ProposerPreferencesErrorCode,
  ProposerSlashingErrorCode,
  SyncCommitteeErrorCode,
  VoluntaryExitErrorCode,
} from "../../chain/errors/index.js";
import {PqTiming} from "../../chain/pq/timing.js";
import {Metrics} from "../../metrics/index.js";
import {PeerIdStr} from "../../util/peerId.js";
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
  pqTiming?: PqTiming | null;
};

const timedOutcome = {
  [TopicValidatorResult.Accept]: "accepted",
  [TopicValidatorResult.Ignore]: "ignored",
  [TopicValidatorResult.Reject]: "rejected",
} as const;

/** Records a pq attestation or aggregate and what validation made of it. One that does not decode is not recorded. */
function recordPqMessage(
  timing: PqTiming,
  {topic, msg, msgId, seenTimestampSec}: GossipMessageInfo,
  result: TopicValidatorResult
): void {
  if (topic.boundary.fork !== ForkName.pq) return;
  try {
    if (topic.type === GossipType.beacon_attestation) {
      const {committeeIndex, data} = ssz.pq.SingleAttestation.deserialize(msg.data);
      timing.onGossipMessage(
        {
          kind: "individual",
          id: msgId,
          slot: data.slot,
          committee: committeeIndex,
          subnet: topic.subnet,
          bytes: msg.data.length,
          signers: 1,
          dataRoot: ssz.phase0.AttestationData.hashTreeRoot(data),
        },
        seenTimestampSec,
        timedOutcome[result]
      );
    } else if (topic.type === GossipType.beacon_aggregate_and_proof) {
      const {aggregate} = ssz.pq.SignedAggregateAndProof.deserialize(msg.data).message;
      timing.onGossipMessage(
        {
          kind: "aggregate",
          id: msgId,
          slot: aggregate.data.slot,
          committee: aggregate.committeeBits.getSingleTrueBit() ?? 0,
          subnet: null,
          bytes: msg.data.length,
          signers: aggregate.aggregationBits.getTrueBitIndexes().length,
          dataRoot: ssz.phase0.AttestationData.hashTreeRoot(aggregate.data),
        },
        seenTimestampSec,
        timedOutcome[result]
      );
    }
  } catch {
    // Not a message of its topic's type
  }
}

export type OnFatalPeerFn = (peer: PeerIdStr) => void;

type RejectPeerActionRule = {default: PeerAction; byCode?: Record<string, PeerAction>};

/**
 * PeerAction mapping based on the topic and specific codes.
 * Invalid signatures are Fatal on every topic.
 */
const gossipRejectPeerAction: Record<GossipType, RejectPeerActionRule> = {
  [GossipType.beacon_block]: {
    default: PeerAction.LowToleranceError,
    byCode: {[BlockErrorCode.PROPOSAL_SIGNATURE_INVALID]: PeerAction.Fatal},
  },
  [GossipType.blob_sidecar]: {
    default: PeerAction.LowToleranceError,
    byCode: {[BlobSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID]: PeerAction.Fatal},
  },
  [GossipType.data_column_sidecar]: {
    default: PeerAction.LowToleranceError,
    byCode: {[DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID]: PeerAction.Fatal},
  },
  [GossipType.execution_payload]: {
    default: PeerAction.LowToleranceError,
    byCode: {[ExecutionPayloadEnvelopeErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.beacon_aggregate_and_proof]: {
    default: PeerAction.MidToleranceError,
    byCode: {[AttestationErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.beacon_attestation]: {
    default: PeerAction.MidToleranceError,
    byCode: {[AttestationErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.sync_committee_contribution_and_proof]: {
    default: PeerAction.MidToleranceError,
    byCode: {[SyncCommitteeErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.sync_committee]: {
    default: PeerAction.MidToleranceError,
    byCode: {[SyncCommitteeErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.payload_attestation_message]: {
    default: PeerAction.MidToleranceError,
    byCode: {[PayloadAttestationErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.inclusion_list]: {
    default: PeerAction.MidToleranceError,
    byCode: {[InclusionListErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.execution_payload_bid]: {
    default: PeerAction.HighToleranceError,
    byCode: {[ExecutionPayloadBidErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.proposer_preferences]: {
    default: PeerAction.HighToleranceError,
    byCode: {[ProposerPreferencesErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.voluntary_exit]: {
    default: PeerAction.HighToleranceError,
    byCode: {[VoluntaryExitErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.bls_to_execution_change]: {
    default: PeerAction.HighToleranceError,
    byCode: {[BlsToExecutionChangeErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.proposer_slashing]: {
    default: PeerAction.HighToleranceError,
    byCode: {[ProposerSlashingErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  [GossipType.attester_slashing]: {
    default: PeerAction.HighToleranceError,
    byCode: {[AttesterSlashingErrorCode.INVALID_SIGNATURE]: PeerAction.Fatal},
  },
  // light client validators only throw IGNORE
  [GossipType.light_client_finality_update]: {default: PeerAction.HighToleranceError},
  [GossipType.light_client_optimistic_update]: {default: PeerAction.HighToleranceError},
};

export function rejectPeerAction(type: GossipType, code: string): PeerAction {
  const rule = gossipRejectPeerAction[type];
  return rule.byCode?.[code] ?? rule.default;
}

/**
 * Similar to getGossipValidatorFn but return a function to accept a batch of beacon_attestation messages
 * with the same attestation data
 */
export function getGossipValidatorBatchFn(
  gossipHandlers: GossipHandlers,
  modules: ValidatorFnModules,
  onFatalPeer: OnFatalPeerFn
): GossipValidatorBatchFn {
  const {logger, metrics, core, pqTiming} = modules;

  return async function gossipValidatorBatchFn(messageInfos: GossipMessageInfo[]) {
    const results = await validateBatch(messageInfos);
    if (pqTiming) {
      for (const [i, messageInfo] of messageInfos.entries()) recordPqMessage(pqTiming, messageInfo, results[i]);
    }
    return results;
  };

  async function validateBatch(messageInfos: GossipMessageInfo[]): Promise<TopicValidatorResult[]> {
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
          case GossipAction.REJECT: {
            metrics?.networkProcessor.gossipValidationReject.inc({topic: type});
            // only beacon_attestation topic is validated in batch
            metrics?.networkProcessor.gossipAttestationRejectByReason.inc({reason: e.type.code});
            const peerAction = rejectPeerAction(type, e.type.code);
            core.reportPeer(propagationSource, peerAction, e.type.code);
            if (peerAction === PeerAction.Fatal) onFatalPeer(propagationSource);
            logger.debug(
              `Gossip validation ${type} rejected`,
              {peer: propagationSource, clientAgent, clientVersion, peerAction},
              e
            );
            return TopicValidatorResult.Reject;
          }
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
  }
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
export function getGossipValidatorFn(
  gossipHandlers: GossipHandlers,
  modules: ValidatorFnModules,
  onFatalPeer: OnFatalPeerFn
): GossipValidatorFn {
  const {logger, metrics, core, pqTiming} = modules;

  return async function gossipValidatorFn(messageInfo) {
    const result = await validate(messageInfo);
    if (pqTiming) recordPqMessage(pqTiming, messageInfo, result);
    return result;
  };

  async function validate({
    topic,
    msg,
    propagationSource,
    clientAgent,
    clientVersion,
    seenTimestampSec,
    msgSlot,
  }: GossipMessageInfo): Promise<TopicValidatorResult> {
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

        case GossipAction.REJECT: {
          metrics?.networkProcessor.gossipValidationReject.inc({topic: type});
          const peerAction = rejectPeerAction(type, e.type.code);
          core.reportPeer(propagationSource, peerAction, e.type.code);
          if (peerAction === PeerAction.Fatal) onFatalPeer(propagationSource);
          logger.debug(
            `Gossip validation ${type} rejected`,
            {peer: propagationSource, clientAgent, clientVersion, peerAction},
            e
          );
          return TopicValidatorResult.Reject;
        }
      }
    }
  }
}
