import {ForkName} from "@lodestar/params";
import {IndexedAttestation, SignedAggregateAndProof, sszTypesFor} from "@lodestar/types";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {GossipActionError} from "../../errors/gossipValidation.js";
import * as aggregateAndProofValidation from "../../validation/aggregateAndProof.js";
import * as attestationValidation from "../../validation/attestation.js";
import type {AggregatorTracker} from "../aggregatorTracker.js";
import type {BeaconEngineCore} from "../beaconEngineCore.js";
import {GossipValidationResult, fromResult, ignore, runGossipValidation} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/attestation.ts#validateGossipAttestationsSameAttData.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#getBatchHandlers.
 * [beacon-engine] deviation: pool/fork-choice updates precede verdicts; monitoring stays deferred.
 */
export async function validateGossipAttestationsSameAttData(
  this: BeaconEngineCore,
  isClosed: () => boolean,
  aggregatorTracker: AggregatorTracker,
  fork: ForkName,
  attestations: attestationValidation.GossipAttestation[],
  seenTimestampSecs: number[]
): Promise<{
  results: GossipValidationResult<attestationValidation.AttestationValidationResult>[];
  batchableBls: boolean;
}> {
  try {
    const {results, batchableBls} = await attestationValidation.validateGossipAttestationsSameAttData.call(
      this,
      fork,
      attestations
    );
    const mapped = results.map(fromResult);
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#getBatchHandlers.
    // Consult current duties after validation. [beacon-engine] deviation: pool/fork-choice writes
    // still precede the returned verdict instead of running in the deferred network handler.
    for (const res of mapped) {
      if (res.err !== null) {
        continue;
      }
      const value = res.result;
      if (aggregatorTracker.shouldAggregate(value.subnet, value.indexedAttestation.data.slot)) {
        try {
          const insertOutcome = this.attestationPool.add(
            value.committeeIndex,
            value.attestation,
            value.attDataRootHex,
            value.validatorCommitteeIndex,
            value.committeeSize
          );
          this.metrics?.opPool.attestationPool.gossipInsertOutcome.inc({insertOutcome});
        } catch (e) {
          this.logger.error("Error adding unaggregated attestation to pool", {subnet: value.subnet}, e as Error);
        }
      }
      if (!this.opts.dontSendGossipAttestationsToForkchoice) {
        try {
          this.forkChoice.onAttestation(value.indexedAttestation, value.attDataRootHex);
        } catch (e) {
          this.logger.debug(
            "Error adding gossip unaggregated attestation to forkchoice",
            {subnet: value.subnet},
            e as Error
          );
        }
      }
    }
    // Source: unstable@0edec865c8 network/processor/gossipHandlers.ts#getBatchHandlers.
    if (this.validatorMonitor) {
      callInNextEventLoop(() => {
        if (isClosed()) return;
        for (const [i, res] of mapped.entries()) {
          if (res.err !== null) continue;
          try {
            this.validatorMonitor?.registerGossipUnaggregatedAttestation(
              seenTimestampSecs[i],
              res.result.indexedAttestation
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip attestation",
              {slot: res.result.indexedAttestation.data.slot},
              e as Error
            );
          }
        }
      });
    }
    return {results: mapped, batchableBls};
  } catch (error) {
    this.logger.error("Error validating gossip attestations", {code: "UNEXPECTED_ERROR"}, error as Error);
    return {results: attestations.map(() => ignore("UNEXPECTED_ERROR")), batchableBls: false};
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/attestation.ts#validateApiAttestation.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolAttestationsV2.
 * [beacon-engine] deviation: return a validation result; the API retains pool insertion and publication.
 */
export function validateApiAttestation(
  this: BeaconEngineCore,
  fork: ForkName,
  attestationOrBytes: attestationValidation.ApiAttestation
): Promise<GossipValidationResult<attestationValidation.AttestationValidationResult>> {
  return runGossipValidation(() => attestationValidation.validateApiAttestation.call(this, fork, attestationOrBytes));
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/aggregateAndProof.ts#validateGossipAggregateAndProof.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.beacon_aggregate_and_proof.
 * [beacon-engine] deviation: pool/fork-choice updates precede the verdict; monitoring stays deferred.
 */
export async function validateGossipAggregateAndProof(
  this: BeaconEngineCore,
  isClosed: () => boolean,
  aggregateBytes: Uint8Array,
  fork: ForkName,
  seenTimestampSec: number
): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
  try {
    const signedAggregateAndProof = deserializeGossipMessage(
      sszTypesFor(fork).SignedAggregateAndProof,
      aggregateBytes,
      this.serializedCache,
      // SSZ byte reuse can clear bitlist padding in the original gossip bytes.
      {reuseBytes: false}
    );
    return await runGossipValidation(async () => {
      const result = await aggregateAndProofValidation.validateGossipAggregateAndProof.call(
        this,
        fork,
        signedAggregateAndProof,
        aggregateBytes
      );
      // Insert into the aggregated-attestation pool on Accept (moved from the gossip handler).
      const insertOutcome = this.aggregatedAttestationPool.add(
        signedAggregateAndProof.message.aggregate,
        result.attDataRootHex,
        result.indexedAttestation.attestingIndices.length,
        result.committeeValidatorIndices
      );
      this.metrics?.opPool.aggregatedAttestationPool.gossipInsertOutcome.inc({insertOutcome});
      // Fork-choice write on Accept (moved from the gossip handler). Contain errors — a fork-choice error
      // must not flip the gossip verdict.
      if (!this.opts.dontSendGossipAttestationsToForkchoice) {
        try {
          this.forkChoice.onAttestation(result.indexedAttestation, result.attDataRootHex);
        } catch (e) {
          this.logger.debug(
            "Error adding gossip aggregated attestation to forkchoice",
            {slot: result.indexedAttestation.data.slot},
            e as Error
          );
        }
      }
      if (this.validatorMonitor) {
        callInNextEventLoop(() => {
          if (isClosed()) return;
          try {
            this.validatorMonitor?.registerGossipAggregatedAttestation(
              seenTimestampSec,
              signedAggregateAndProof,
              result.indexedAttestation
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip aggregate and proof",
              {slot: result.indexedAttestation.data.slot},
              e as Error
            );
          }
        });
      }
      return {indexedAttestation: result.indexedAttestation};
    });
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip aggregate and proof", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/aggregateAndProof.ts#validateApiAggregateAndProof.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/validator/index.ts#publishAggregateAndProofsV2.
 * [beacon-engine] deviation: insert into the engine pool and return only the indexed attestation.
 */
export function validateApiAggregateAndProof(
  this: BeaconEngineCore,
  _aggregateBytes: Uint8Array,
  fork: ForkName,
  signedAggregateAndProof: SignedAggregateAndProof
): Promise<GossipValidationResult<{indexedAttestation: IndexedAttestation}>> {
  return runGossipValidation(async () => {
    const result = await aggregateAndProofValidation.validateApiAggregateAndProof.call(
      this,
      fork,
      signedAggregateAndProof
    );
    // Insert into the aggregated-attestation pool on Accept (moved from the API handler).
    const insertOutcome = this.aggregatedAttestationPool.add(
      signedAggregateAndProof.message.aggregate,
      result.attDataRootHex,
      result.indexedAttestation.attestingIndices.length,
      result.committeeValidatorIndices
    );
    this.metrics?.opPool.aggregatedAttestationPool.apiInsertOutcome.inc({insertOutcome});
    return {indexedAttestation: result.indexedAttestation};
  });
}
