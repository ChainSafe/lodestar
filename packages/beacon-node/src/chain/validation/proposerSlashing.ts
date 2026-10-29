import {assertValidProposerSlashing, getProposerSlashingSignatureSets} from "@lodestar/state-transition";
import {Domain, phase0} from "@lodestar/types";
import {GossipAction, ProposerSlashingError, ProposerSlashingErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {getProposerSlashingSignatureDomain} from "../opPools/utils.js";

export async function validateApiProposerSlashing(
  chain: IBeaconChain,
  proposerSlashing: phase0.ProposerSlashing
): Promise<Domain> {
  const prioritizeBls = true;
  return validateProposerSlashing(chain, proposerSlashing, prioritizeBls);
}

export async function validateGossipProposerSlashing(
  chain: IBeaconChain,
  proposerSlashing: phase0.ProposerSlashing
): Promise<Domain> {
  return validateProposerSlashing(chain, proposerSlashing);
}

async function validateProposerSlashing(
  chain: IBeaconChain,
  proposerSlashing: phase0.ProposerSlashing,
  prioritizeBls = false
): Promise<Domain> {
  // [IGNORE] The proposer slashing is the first valid proposer slashing received for the proposer with index
  // proposer_slashing.signed_header_1.message.proposer_index.
  if (chain.opPool.hasSeenProposerSlashing(proposerSlashing.signedHeader1.message.proposerIndex)) {
    throw new ProposerSlashingError(GossipAction.IGNORE, {
      code: ProposerSlashingErrorCode.ALREADY_EXISTS,
    });
  }

  const state = chain.getHeadState();

  // [REJECT] All of the conditions within process_proposer_slashing pass validation.
  try {
    const proposer = state.getValidator(proposerSlashing.signedHeader1.message.proposerIndex);
    // verifySignature = false, verified in batch below
    assertValidProposerSlashing(chain.config, state.slot, proposerSlashing, proposer, false);
  } catch (e) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID,
      error: e as Error,
    });
  }

  const signatureSets = getProposerSlashingSignatureSets(chain.config, state.slot, proposerSlashing);
  const verifiedDomain = getProposerSlashingSignatureDomain(chain.config, state.slot, proposerSlashing);
  if (!(await chain.bls.verifySignatureSets(signatureSets, {batchable: true, priority: prioritizeBls}))) {
    throw new ProposerSlashingError(GossipAction.REJECT, {
      code: ProposerSlashingErrorCode.INVALID_SIGNATURE,
    });
  }
  return verifiedDomain;
}
