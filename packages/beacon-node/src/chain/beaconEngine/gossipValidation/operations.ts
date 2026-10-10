import {ForkName} from "@lodestar/params";
import {AttesterSlashing, capella, gloas, phase0} from "@lodestar/types";
import * as attesterSlashingValidation from "../../validation/attesterSlashing.js";
import * as blsToExecutionChangeValidation from "../../validation/blsToExecutionChange.js";
import * as proposerPreferencesValidation from "../../validation/proposerPreferences.js";
import * as proposerSlashingValidation from "../../validation/proposerSlashing.js";
import * as voluntaryExitValidation from "../../validation/voluntaryExit.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {GossipValidationResult, GossipValidationStatus, runGossipValidation} from "../gossipValidationResult.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/proposerPreferences.ts#validateGossipProposerPreferences.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.proposer_preferences.
 * [beacon-engine] deviation: insert into the engine pool before returning the verdict.
 */
export async function validateGossipProposerPreferences(
  this: BeaconEngine,
  _preferencesBytes: Uint8Array,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<GossipValidationResult<void>> {
  const res = await runGossipValidation(() =>
    proposerPreferencesValidation.validateGossipProposerPreferences.call(this, signedProposerPreferences)
  );
  // Insert on Accept — the pool is engine-internal, so the facade (gossip handler / API) no longer adds.
  if (res.status === GossipValidationStatus.Accept) {
    this.proposerPreferencesPool.add(signedProposerPreferences);
  }
  return res;
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/attesterSlashing.ts#validateGossipAttesterSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/network/processor/gossipHandlers.ts#GossipType.attester_slashing.
 * [beacon-engine] deviation: pool/fork-choice writes precede the verdict; consume verified domains internally.
 */
export async function validateGossipAttesterSlashing(
  this: BeaconEngine,
  attesterSlashing: AttesterSlashing,
  fork: ForkName
): Promise<GossipValidationResult<void>> {
  const res = await runGossipValidation(() =>
    attesterSlashingValidation.validateGossipAttesterSlashing.call(this, attesterSlashing)
  );
  if (res.status === GossipValidationStatus.Accept) {
    // Contain insert failures — a pool error must not flip the gossip verdict (matches prior handler).
    try {
      this.opPool.insertAttesterSlashing(fork, attesterSlashing, res.value);
      this.forkChoice.onAttesterSlashing(attesterSlashing);
    } catch (e) {
      this.logger.error("Error adding attesterSlashing to pool", {}, e as Error);
    }
  }
  return res.status === GossipValidationStatus.Accept ? {...res, value: undefined} : res;
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/attesterSlashing.ts#validateApiAttesterSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolAttesterSlashingsV2.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export async function validateApiAttesterSlashing(
  this: BeaconEngine,
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
  this: BeaconEngine,
  proposerSlashing: phase0.ProposerSlashing
): Promise<GossipValidationResult<void>> {
  const res = await runGossipValidation(() =>
    proposerSlashingValidation.validateGossipProposerSlashing.call(this, proposerSlashing)
  );
  if (res.status === GossipValidationStatus.Accept) {
    try {
      this.opPool.insertProposerSlashing(proposerSlashing, res.value);
    } catch (e) {
      this.logger.error("Error adding proposerSlashing to pool", {}, e as Error);
    }
  }
  return res.status === GossipValidationStatus.Accept ? {...res, value: undefined} : res;
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/proposerSlashing.ts#validateApiProposerSlashing.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolProposerSlashings.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export async function validateApiProposerSlashing(
  this: BeaconEngine,
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
  this: BeaconEngine,
  voluntaryExit: phase0.SignedVoluntaryExit
): Promise<GossipValidationResult<void>> {
  const res = await runGossipValidation(() =>
    voluntaryExitValidation.validateGossipVoluntaryExit.call(this, voluntaryExit)
  );
  if (res.status === GossipValidationStatus.Accept) {
    try {
      this.opPool.insertVoluntaryExit(voluntaryExit);
    } catch (e) {
      this.logger.error("Error adding voluntaryExit to pool", {}, e as Error);
    }
  }
  return res;
}

/**
 * Validation source: unstable@ba0411b482 packages/beacon-node/src/chain/validation/voluntaryExit.ts#validateApiVoluntaryExit.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolVoluntaryExit.
 * [beacon-engine] deviation: insert or defer in the engine; return insertion status for API error handling.
 */
export async function validateApiVoluntaryExit(
  this: BeaconEngine,
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
  this: BeaconEngine,
  blsToExecutionChange: capella.SignedBLSToExecutionChange
): Promise<GossipValidationResult<void>> {
  const res = await runGossipValidation(() =>
    blsToExecutionChangeValidation.validateGossipBlsToExecutionChange.call(this, blsToExecutionChange)
  );
  if (res.status === GossipValidationStatus.Accept) {
    try {
      this.opPool.insertBlsToExecutionChange(blsToExecutionChange);
    } catch (e) {
      this.logger.error("Error adding blsToExecutionChange to pool", {}, e as Error);
    }
  }
  return res;
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/blsToExecutionChange.ts#validateApiBlsToExecutionChange.
 * Handler source: unstable@0edec865c8 packages/beacon-node/src/api/impl/beacon/pool/index.ts#submitPoolBLSToExecutionChange.
 * [beacon-engine] deviation: validate and insert in the engine; the API publishes.
 */
export async function validateApiBlsToExecutionChange(
  this: BeaconEngine,
  blsToExecutionChange: capella.SignedBLSToExecutionChange,
  preCapella: boolean
): Promise<void> {
  await blsToExecutionChangeValidation.validateApiBlsToExecutionChange.call(this, blsToExecutionChange);
  this.opPool.insertBlsToExecutionChange(blsToExecutionChange, preCapella);
}
