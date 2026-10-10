import {ValidatorIndex, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {PayloadEnvelopeInputSource, SourceMeta} from "../../blocks/payloadEnvelopeInput/types.js";
import * as executionPayloadBidValidation from "../../validation/executionPayloadBid.js";
import * as executionPayloadEnvelopeValidation from "../../validation/executionPayloadEnvelope.js";
import * as payloadAttestationMessageValidation from "../../validation/payloadAttestationMessage.js";
import {OpSource} from "../../validatorMonitor.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {GossipValidationResult, runGossipValidation} from "../gossipValidationResult.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/payloadAttestationMessage.ts#validateGossipPayloadAttestationMessage.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.payload_attestation_message.
 * [beacon-engine] deviation: pool/fork-choice updates precede the verdict; consume indices internally.
 */
export function validateGossipPayloadAttestationMessage(
  this: BeaconEngine,
  _payloadAttestationBytes: Uint8Array,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(async () => {
    const result = await payloadAttestationMessageValidation.validateGossipPayloadAttestationMessage.call(
      this,
      payloadAttestationMessage
    );
    // Insert into the pool + notify fork choice on Accept (moved from the gossip handler). The rich result
    // is consumed here internally; the facade only needs the Accept/Reject verdict, so nothing is returned.
    // TODO - beacon engine: schedule these side effects after the gossip verdict, as upstream does.
    try {
      insertPayloadAttestationOnAccept.call(this, payloadAttestationMessage, result, "gossip");
    } catch (e) {
      this.logger.debug(
        "Error handling gossip payload attestation message",
        {slot: payloadAttestationMessage.data.slot, root: toRootHex(payloadAttestationMessage.data.beaconBlockRoot)},
        e as Error
      );
    }
  });
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/payloadAttestationMessage.ts#validateApiPayloadAttestationMessage.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPayloadAttestationMessages.
 * [beacon-engine] deviation: pool/fork-choice updates run in the engine; the API publishes.
 */
export function validateApiPayloadAttestationMessage(
  this: BeaconEngine,
  _payloadAttestationBytes: Uint8Array,
  payloadAttestationMessage: gloas.PayloadAttestationMessage
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(async () => {
    const result = await payloadAttestationMessageValidation.validateApiPayloadAttestationMessage.call(
      this,
      payloadAttestationMessage
    );
    // Insert into the pool + notify fork choice on Accept (moved from the API handler); nothing returned.
    insertPayloadAttestationOnAccept.call(this, payloadAttestationMessage, result, "api");
  });
}

/**
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.payload_attestation_message.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPayloadAttestationMessages.
 * [beacon-engine] deviation: shared engine pool/fork-choice updates; retain proposer gating and API error propagation.
 */
function insertPayloadAttestationOnAccept(
  this: BeaconEngine,
  message: gloas.PayloadAttestationMessage,
  result: payloadAttestationMessageValidation.PayloadAttestationValidationResult,
  source: "gossip" | "api"
): void {
  const {attDataRootHex, validatorCommitteeIndices} = result;
  if (source === "gossip") {
    const nextSlotProposer = this.getHeadState().getBeaconProposer(message.data.slot + 1);
    if (this.beaconProposerCache.get(nextSlotProposer) !== undefined) {
      try {
        const insertOutcome = this.payloadAttestationPool.add(message, attDataRootHex, validatorCommitteeIndices);
        this.metrics?.opPool.payloadAttestationPool.gossipInsertOutcome.inc({insertOutcome});
      } catch (e) {
        this.logger.debug("Error adding to payloadAttestation pool", {}, e as Error);
      }
    }
  } else {
    // API path does not swallow (matches prior handler — a pool error surfaces as a submit failure).
    const insertOutcome = this.payloadAttestationPool.add(message, attDataRootHex, validatorCommitteeIndices);
    this.metrics?.opPool.payloadAttestationPool.apiInsertOutcome.inc({insertOutcome});
  }
  this.forkChoice.notifyPtcMessages(
    toRootHex(message.data.beaconBlockRoot),
    message.data.slot,
    validatorCommitteeIndices,
    message.data.payloadPresent,
    message.data.blobDataAvailable
  );
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/executionPayloadEnvelope.ts#validateGossipExecutionPayloadEnvelope.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.execution_payload.
 * [beacon-engine] deviation: cache and monitor the envelope in the engine before returning a verdict.
 */
export function validateGossipExecutionPayloadEnvelope(
  this: BeaconEngine,
  _envelopeBytes: Uint8Array,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  source: SourceMeta
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(async () => {
    await executionPayloadEnvelopeValidation.validateGossipExecutionPayloadEnvelope.call(
      this,
      executionPayloadEnvelope
    );
    this.seenPayloadEnvelopeInputCache
      .get(toRootHex(executionPayloadEnvelope.message.beaconBlockRoot))
      ?.addPayloadEnvelope({
        envelope: executionPayloadEnvelope,
        ...source,
      });
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#execution_payload.
    if (source.source === PayloadEnvelopeInputSource.gossip && this.validatorMonitor) {
      const slot = executionPayloadEnvelope.message.payload.slotNumber;
      try {
        this.validatorMonitor.registerExecutionPayloadEnvelope(
          OpSource.gossip,
          this.clock.secFromSlot(slot, source.seenTimestampSec),
          executionPayloadEnvelope
        );
      } catch (e) {
        this.logger.debug("Error monitoring gossip execution payload envelope", {slot}, e as Error);
      }
    }
  });
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/executionPayloadEnvelope.ts#validateApiExecutionPayloadEnvelope.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/blocks/index.ts#publishExecutionPayloadEnvelope.
 * [beacon-engine] deviation: record API validation in the engine envelope cache.
 */
export function validateApiExecutionPayloadEnvelope(
  this: BeaconEngine,
  _envelopeBytes: Uint8Array,
  executionPayloadEnvelope: gloas.SignedExecutionPayloadEnvelope,
  seenTimestampSec: number
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(async () => {
    await executionPayloadEnvelopeValidation.validateApiExecutionPayloadEnvelope.call(this, executionPayloadEnvelope);
    this.seenPayloadEnvelopeInputCache
      .get(toRootHex(executionPayloadEnvelope.message.beaconBlockRoot))
      ?.addPayloadEnvelope({
        envelope: executionPayloadEnvelope,
        source: PayloadEnvelopeInputSource.api,
        seenTimestampSec,
      });
  });
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/executionPayloadBid.ts#validateGossipExecutionPayloadBid.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.execution_payload_bid.
 * [beacon-engine] deviation: pool insertion precedes the verdict; monitoring stays deferred.
 */
export function validateGossipExecutionPayloadBid(
  this: BeaconEngine,
  isClosed: () => boolean,
  _bidBytes: Uint8Array,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid,
  seenTimestampSec: number
): Promise<GossipValidationResult<{proposerIndex: ValidatorIndex}>> {
  return runGossipValidation(async () => {
    const result = await executionPayloadBidValidation.validateGossipExecutionPayloadBid.call(
      this,
      signedExecutionPayloadBid
    );
    // TODO - beacon engine: reconcile deferred gossip side effects with upstream before completing this merge.
    // Insert into the bid pool on Accept (moved from the gossip handler).
    try {
      const insertOutcome = this.executionPayloadBidPool.add(
        signedExecutionPayloadBid,
        Math.floor(this.clock.secFromSlot(signedExecutionPayloadBid.message.slot, seenTimestampSec) * 1000)
      );
      this.metrics?.opPool.executionPayloadBidPool.gossipInsertOutcome.inc({insertOutcome});
      // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#execution_payload_bid.
      if (this.validatorMonitor) {
        callInNextEventLoop(() => {
          if (isClosed()) return;
          try {
            this.validatorMonitor?.registerExecutionPayloadBid(
              OpSource.gossip,
              result.proposerIndex,
              signedExecutionPayloadBid.message
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip execution payload bid",
              {slot: signedExecutionPayloadBid.message.slot},
              e as Error
            );
          }
        });
      }
    } catch (e) {
      this.logger.error("Error adding to executionPayloadBid pool", {}, e as Error);
    }
    return result;
  });
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/executionPayloadBid.ts#validateApiExecutionPayloadBid.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/blocks/index.ts#publishExecutionPayloadBid.
 * [beacon-engine] deviation: return a validation verdict; API orchestration remains in the caller.
 */
export function validateApiExecutionPayloadBid(
  this: BeaconEngine,
  _bidBytes: Uint8Array,
  signedExecutionPayloadBid: gloas.SignedExecutionPayloadBid
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(() =>
    executionPayloadBidValidation.validateApiExecutionPayloadBid.call(this, signedExecutionPayloadBid)
  );
}
