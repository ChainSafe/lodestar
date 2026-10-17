import {ForkName} from "@lodestar/params";
import {AttesterSlashing, capella, phase0, ssz, sszTypesFor} from "@lodestar/types";
import {GossipActionError} from "../../errors/gossipValidation.js";
import * as attesterSlashingValidation from "../../validation/attesterSlashing.js";
import * as blsToExecutionChangeValidation from "../../validation/blsToExecutionChange.js";
import * as proposerPreferencesValidation from "../../validation/proposerPreferences.js";
import * as proposerSlashingValidation from "../../validation/proposerSlashing.js";
import * as voluntaryExitValidation from "../../validation/voluntaryExit.js";
import type {BeaconEngineCore} from "../beaconEngineCore.js";
import {GossipValidationResult, fromResult, ignore, runGossipValidation} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/proposerPreferences.ts#validateGossipProposerPreferences.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.proposer_preferences.
 * [beacon-engine] deviation: insert into the engine pool before returning the verdict.
 */
export async function validateGossipProposerPreferences(
  this: BeaconEngineCore,
  preferencesBytes: Uint8Array
): Promise<GossipValidationResult<void>> {
  try {
    const signedProposerPreferences = deserializeGossipMessage(
      ssz.gloas.SignedProposerPreferences,
      preferencesBytes,
      this.serializedCache
    );
    const res = await runGossipValidation(() =>
      proposerPreferencesValidation.validateGossipProposerPreferences.call(this, signedProposerPreferences)
    );
    // Insert on Accept — the pool is engine-internal, so the facade (gossip handler / API) no longer adds.
    if (res.err === null) {
      this.proposerPreferencesPool.add(signedProposerPreferences);
    }
    return res;
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip proposer preferences", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/attesterSlashing.ts#validateGossipAttesterSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.attester_slashing.
 * [beacon-engine] deviation: pool/fork-choice writes precede the verdict; consume verified domains internally.
 */
export async function validateGossipAttesterSlashing(
  this: BeaconEngineCore,
  attesterSlashingBytes: Uint8Array,
  fork: ForkName
): Promise<GossipValidationResult<void>> {
  try {
    const attesterSlashing = deserializeGossipMessage(
      sszTypesFor(fork).AttesterSlashing,
      attesterSlashingBytes,
      this.serializedCache
    );
    const res = await runGossipValidation(() =>
      attesterSlashingValidation.validateGossipAttesterSlashing.call(this, attesterSlashing)
    );
    if (res.err === null) {
      // Contain insert failures — a pool error must not flip the gossip verdict (matches prior handler).
      try {
        this.opPool.insertAttesterSlashing(fork, attesterSlashing, res.result);
        this.forkChoice.onAttesterSlashing(attesterSlashing);
      } catch (e) {
        this.logger.error("Error adding attesterSlashing to pool", {}, e as Error);
      }
    }
    return res.err === null ? {...res, result: undefined} : res;
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip attester slashing", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/attesterSlashing.ts#validateApiAttesterSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolAttesterSlashingsV2.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export async function validateApiAttesterSlashing(
  this: BeaconEngineCore,
  attesterSlashing: AttesterSlashing,
  fork: ForkName
): Promise<void> {
  const verifiedDomains = await attesterSlashingValidation.validateApiAttesterSlashing.call(this, attesterSlashing);
  this.opPool.insertAttesterSlashing(fork, attesterSlashing, verifiedDomains);
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/proposerSlashing.ts#validateGossipProposerSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.proposer_slashing.
 * [beacon-engine] deviation: pool insertion precedes the verdict; consume the verified domain internally.
 */
export async function validateGossipProposerSlashing(
  this: BeaconEngineCore,
  proposerSlashingBytes: Uint8Array
): Promise<GossipValidationResult<void>> {
  try {
    const proposerSlashing = deserializeGossipMessage(
      ssz.phase0.ProposerSlashing,
      proposerSlashingBytes,
      this.serializedCache
    );
    const res = await runGossipValidation(() =>
      proposerSlashingValidation.validateGossipProposerSlashing.call(this, proposerSlashing)
    );
    if (res.err === null) {
      try {
        this.opPool.insertProposerSlashing(proposerSlashing, res.result);
      } catch (e) {
        this.logger.error("Error adding proposerSlashing to pool", {}, e as Error);
      }
    }
    return res.err === null ? {...res, result: undefined} : res;
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip proposer slashing", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/proposerSlashing.ts#validateApiProposerSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolProposerSlashings.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export async function validateApiProposerSlashing(
  this: BeaconEngineCore,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  const verifiedDomain = await proposerSlashingValidation.validateApiProposerSlashing.call(this, proposerSlashing);
  this.opPool.insertProposerSlashing(proposerSlashing, verifiedDomain);
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/voluntaryExit.ts#validateGossipVoluntaryExit.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.voluntary_exit.
 * [beacon-engine] deviation: pool insertion precedes the verdict; API/network event handling stays outside.
 */
export async function validateGossipVoluntaryExit(
  this: BeaconEngineCore,
  voluntaryExitBytes: Uint8Array
): Promise<GossipValidationResult<void>> {
  try {
    const voluntaryExit = deserializeGossipMessage(
      ssz.phase0.SignedVoluntaryExit,
      voluntaryExitBytes,
      this.serializedCache
    );
    const res = await runGossipValidation(() =>
      voluntaryExitValidation.validateGossipVoluntaryExit.call(this, voluntaryExit)
    );
    if (res.err === null) {
      try {
        this.opPool.insertVoluntaryExit(voluntaryExit);
      } catch (e) {
        this.logger.error("Error adding voluntaryExit to pool", {}, e as Error);
      }
    }
    return res;
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip voluntary exit", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@ba0411b482 packages/beacon-node/src/chain/validation/voluntaryExit.ts#validateApiVoluntaryExit.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolVoluntaryExit.
 * [beacon-engine] deviation: insert or defer in the engine; return insertion status for API error handling.
 */
export async function validateApiVoluntaryExit(
  this: BeaconEngineCore,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<voluntaryExitValidation.ApiVoluntaryExitResult & {inserted?: boolean}> {
  const result = await voluntaryExitValidation.validateApiVoluntaryExit.call(this, voluntaryExit);
  if (result.status === "deferred")
    return {
      ...result,
      inserted: this.deferredVoluntaryExitPool.insert(voluntaryExit, result.validity, this.clock.currentEpoch),
    };
  this.opPool.insertVoluntaryExit(voluntaryExit);
  return result;
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blsToExecutionChange.ts#validateGossipBlsToExecutionChange.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.bls_to_execution_change.
 * [beacon-engine] deviation: pool insertion precedes the verdict; API/network event handling stays outside.
 */
export async function validateGossipBlsToExecutionChange(
  this: BeaconEngineCore,
  blsToExecutionChangeBytes: Uint8Array
): Promise<GossipValidationResult<void>> {
  try {
    const blsToExecutionChange = deserializeGossipMessage(
      ssz.capella.SignedBLSToExecutionChange,
      blsToExecutionChangeBytes,
      this.serializedCache
    );
    const res = await runGossipValidation(() =>
      blsToExecutionChangeValidation.validateGossipBlsToExecutionChange.call(this, blsToExecutionChange)
    );
    if (res.err === null) {
      try {
        this.opPool.insertBlsToExecutionChange(blsToExecutionChange);
      } catch (e) {
        this.logger.error("Error adding blsToExecutionChange to pool", {}, e as Error);
      }
    }
    return res;
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip bls to execution change", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blsToExecutionChange.ts#validateApiBlsToExecutionChange.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolBLSToExecutionChange.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export async function validateApiBlsToExecutionChange(
  this: BeaconEngineCore,
  blsToExecutionChange: capella.SignedBLSToExecutionChange,
  preCapella: boolean
): Promise<void> {
  await blsToExecutionChangeValidation.validateApiBlsToExecutionChange.call(this, blsToExecutionChange);
  this.opPool.insertBlsToExecutionChange(blsToExecutionChange, preCapella);
}
