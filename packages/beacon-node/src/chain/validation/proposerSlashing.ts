import {assertValidProposerSlashing, getProposerSlashingSignatureSets} from "@lodestar/state-transition";
import {phase0} from "@lodestar/types";
import type {BeaconEngine} from "../beaconEngine/beaconEngine.js";
import {GossipAction, ProposerSlashingError, ProposerSlashingErrorCode} from "../errors/index.js";

export async function validateApiProposerSlashing(
  this: BeaconEngine,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  const prioritizeBls = true;
  return validateProposerSlashing.call(this, proposerSlashing, prioritizeBls);
}

export async function validateGossipProposerSlashing(
  this: BeaconEngine,
  proposerSlashing: phase0.ProposerSlashing
): Promise<void> {
  return validateProposerSlashing.call(this, proposerSlashing);
}

async function validateProposerSlashing(
  this: BeaconEngine,
  proposerSlashing: phase0.ProposerSlashing,
  prioritizeBls = false
): Promise<void> {
  // [IGNORE] The proposer slashing is the first valid proposer slashing received for the proposer with index
  // proposer_slashing.signed_header_1.message.proposer_index.
  if (this.opPool.hasSeenProposerSlashing(proposerSlashing.signedHeader1.message.proposerIndex)) {
    throw new ProposerSlashingError(GossipAction.IGNORE, {
      code: ProposerSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = this.getHeadState();

  // [REJECT] All of the conditions within process_proposer_slashing pass validation.
  try {
    const proposer = state.getValidator(proposerSlashing.signedHeader1.message.proposerIndex);
    // verifySignature = false, verified in batch below
    assertValidProposerSlashing(this.config, this.pubkeyCache, state.slot, proposerSlashing, proposer, false);
  } catch (e) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = getProposerSlashingSignatureSets(this.config, state.slot, proposerSlashing);
  if (!(await this.bls.verifySignatureSets(signatureSets, {batchable: true, priority: prioritizeBls}))) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID,
      error: Error("Invalid signature"),
    });
  }
}
