import {SYNC_COMMITTEE_SUBNET_SIZE} from "@lodestar/params";
import {isStatePostAltair} from "@lodestar/state-transition";
import {SubnetID, ValidatorIndex, altair, ssz} from "@lodestar/types";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {GossipActionError} from "../../errors/gossipValidation.js";
import * as syncCommitteeValidation from "../../validation/syncCommittee.js";
import * as syncCommitteeContributionAndProofValidation from "../../validation/syncCommitteeContributionAndProof.js";
import type {BeaconEngineCore} from "../beaconEngineCore.js";
import {GossipValidationResult, fromResult, ignore, runGossipValidation} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/syncCommittee.ts#validateGossipSyncCommittee.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.sync_committee.
 * [beacon-engine] deviation: insert into the engine pool before returning the verdict.
 */
export async function validateGossipSyncCommitteeBytes(
  this: BeaconEngineCore,
  syncCommitteeBytes: Uint8Array,
  subnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    const syncCommittee = deserializeGossipMessage(ssz.altair.SyncCommitteeMessage, syncCommitteeBytes);
    return await validateGossipSyncCommittee.call(this, syncCommittee, subnet);
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip sync committee", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

export async function validateGossipSyncCommittee(
  this: BeaconEngineCore,
  syncCommittee: altair.SyncCommitteeMessage,
  subnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    return await runGossipValidation(async () => {
      const result = await syncCommitteeValidation.validateGossipSyncCommittee.call(this, syncCommittee, subnet);
      // Insert for ALL positions this validator holds in the subcommittee (moved from the gossip handler).
      // The subcommittee indices are consumed here internally; the facade only needs the verdict.
      try {
        for (const indexInSubcommittee of result.indicesInSubcommittee) {
          const insertOutcome = this.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee);
          this.metrics?.opPool.syncCommitteeMessagePoolInsertOutcome.inc({insertOutcome});
        }
      } catch (e) {
        this.logger.debug("Error adding to syncCommittee pool", {subnet}, e as Error);
      }
    });
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip sync committee", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/syncCommittee.ts#validateApiSyncCommittee.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolSyncCommitteeSignatures.
 * [beacon-engine] deviation: resolve membership and insert in the engine; return subnets for API publication.
 */
export function validateApiSyncCommittee(
  this: BeaconEngineCore,
  syncCommittee: altair.SyncCommitteeMessage
): Promise<GossipValidationResult<{subnets: number[]}>> {
  return runGossipValidation(async () => {
    const state = this.getHeadState();
    // The node's own validators — skip silently if this validator isn't in the sync committee.
    const indexesInCommittee = isStatePostAltair(state)
      ? state.getIndexedSyncCommittee(syncCommittee.slot).validatorIndexMap.get(syncCommittee.validatorIndex)
      : undefined;
    if (indexesInCommittee === undefined || indexesInCommittee.length === 0) {
      return {subnets: []};
    }
    // Verify signature only, all other data is very likely correct since this node produced the signature.
    await syncCommitteeValidation.validateApiSyncCommittee.call(this, syncCommittee);
    // The same validator can appear multiple times in the committee (and per subnet). Insert each position
    // (priority: allow late API messages into the pool) and collect the subnets for the facade to publish.
    const subnets: number[] = [];
    for (const indexInCommittee of indexesInCommittee) {
      const subnet = Math.floor(indexInCommittee / SYNC_COMMITTEE_SUBNET_SIZE);
      const indexInSubcommittee = indexInCommittee % SYNC_COMMITTEE_SUBNET_SIZE;
      this.syncCommitteeMessagePool.add(subnet, syncCommittee, indexInSubcommittee, true);
      if (subnets.length === 0 || subnets.at(-1) !== subnet) {
        subnets.push(subnet);
      }
    }
    return {subnets};
  });
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/syncCommitteeContributionAndProof.ts#validateSyncCommitteeGossipContributionAndProof.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.sync_committee_contribution_and_proof.
 * [beacon-engine] deviation: pool insertion precedes the verdict; monitoring stays deferred.
 */
export async function validateSyncCommitteeGossipContributionAndProofBytes(
  this: BeaconEngineCore,
  contributionBytes: Uint8Array,
  skipValidationKnownParticipants = false
): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
  try {
    const signedContributionAndProof = deserializeGossipMessage(
      ssz.altair.SignedContributionAndProof,
      contributionBytes
    );
    return await validateSyncCommitteeGossipContributionAndProof.call(
      this,
      signedContributionAndProof,
      skipValidationKnownParticipants
    );
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error(
      "Error validating gossip sync committee contribution and proof",
      {code: "UNEXPECTED_ERROR"},
      error as Error
    );
    return ignore("UNEXPECTED_ERROR");
  }
}

export async function validateSyncCommitteeGossipContributionAndProof(
  this: BeaconEngineCore,
  signedContributionAndProof: altair.SignedContributionAndProof,
  skipValidationKnownParticipants = false
): Promise<GossipValidationResult<{syncCommitteeParticipantIndices: ValidatorIndex[]}>> {
  try {
    return await runGossipValidation(async () => {
      const result =
        await syncCommitteeContributionAndProofValidation.validateSyncCommitteeGossipContributionAndProof.call(
          this,
          signedContributionAndProof,
          skipValidationKnownParticipants
        );
      // Insert into the pool on Accept (moved from the gossip handler).
      insertSyncContributionOnAccept.call(
        this,
        signedContributionAndProof,
        result.syncCommitteeParticipantIndices.length,
        "gossip"
      );
      if (this.validatorMonitor) {
        callInNextEventLoop(() => {
          try {
            this.validatorMonitor?.registerGossipSyncContributionAndProof(
              signedContributionAndProof.message,
              result.syncCommitteeParticipantIndices
            );
          } catch (e) {
            this.logger.debug(
              "Error monitoring gossip contribution and proof",
              {slot: signedContributionAndProof.message.contribution.slot},
              e as Error
            );
          }
        });
      }
      return result;
    });
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error(
      "Error validating gossip sync committee contribution and proof",
      {code: "UNEXPECTED_ERROR"},
      error as Error
    );
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/syncCommitteeContributionAndProof.ts#validateSyncCommitteeGossipContributionAndProof.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/validator/index.ts#publishContributionAndProofs.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export function validateApiSyncCommitteeContributionAndProof(
  this: BeaconEngineCore,
  signedContributionAndProof: altair.SignedContributionAndProof
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(async () => {
    // API path skips the known-participants check (the signature object is produced by this node).
    const result =
      await syncCommitteeContributionAndProofValidation.validateSyncCommitteeGossipContributionAndProof.call(
        this,
        signedContributionAndProof,
        true
      );
    // Insert into the pool on Accept (moved from the API handler); the facade only needs the verdict.
    insertSyncContributionOnAccept.call(
      this,
      signedContributionAndProof,
      result.syncCommitteeParticipantIndices.length,
      "api"
    );
  });
}

/**
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.sync_committee_contribution_and_proof.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/validator/index.ts#publishContributionAndProofs.
 * [beacon-engine] deviation: shared engine pool insertion; retain gossip/API priority and error handling.
 */
function insertSyncContributionOnAccept(
  this: BeaconEngineCore,
  signed: altair.SignedContributionAndProof,
  syncCommitteeParticipants: number,
  source: "gossip" | "api"
): void {
  const metric = this.metrics?.opPool.syncContributionAndProofPool;
  if (source === "gossip") {
    try {
      const insertOutcome = this.syncContributionAndProofPool.add(signed.message, syncCommitteeParticipants);
      metric?.gossipInsertOutcome.inc({insertOutcome});
    } catch (e) {
      this.logger.error("Error adding to contributionAndProof pool", {}, e as Error);
    }
  } else {
    // API allows late messages into the pool (priority) and surfaces a pool error as a submit failure.
    const insertOutcome = this.syncContributionAndProofPool.add(signed.message, syncCommitteeParticipants, true);
    metric?.apiInsertOutcome.inc({insertOutcome});
  }
}
