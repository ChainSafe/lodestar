import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getProposerPreferencesSigningRoot,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {GossipAction, ProposerPreferencesError, ProposerPreferencesErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import {RegenCaller} from "../regen/index.js";

export async function validateApiProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<void> {
  const prioritizeBls = true;
  return validateProposerPreferences(chain, signedProposerPreferences, prioritizeBls);
}

export async function validateGossipProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<void> {
  return validateProposerPreferences(chain, signedProposerPreferences);
}

async function validateProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences,
  prioritizeBls = false
): Promise<void> {
  const preferences = signedProposerPreferences.message;
  const {proposalSlot, validatorIndex} = preferences;
  const proposalEpoch = computeEpochAtSlot(proposalSlot);

  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipProposerPreferences);
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for proposer preferences validation, got fork=${state.forkName}`);
  }
  const currentEpoch = state.epoch;

  // [IGNORE] `preferences.proposal_slot` is in the current or next epoch.
  if (proposalEpoch < currentEpoch || proposalEpoch > currentEpoch + 1) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.INVALID_EPOCH,
      proposalSlot,
      currentEpoch,
    });
  }

  // [IGNORE] `preferences.proposal_slot` has not already passed.
  if (proposalSlot <= state.slot) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.PROPOSAL_SLOT_PASSED,
      proposalSlot,
      stateSlot: state.slot,
    });
  }

  // [REJECT] `preferences.validator_index` is present at the correct slot in the current or next epoch's
  // portion of `state.proposer_lookahead` — i.e. `is_valid_proposal_slot(state, preferences)` returns True.
  const proposers = proposalEpoch === currentEpoch ? state.currentProposers : state.nextProposers;
  const expectedProposer = proposers[proposalSlot % SLOTS_PER_EPOCH];
  if (expectedProposer !== validatorIndex) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_PROPOSER,
      proposalSlot,
      validatorIndex,
    });
  }

  // [IGNORE] The `signed_proposer_preferences` is the first valid message received from the validator
  // with index `preferences.validator_index` and the given slot `preferences.proposal_slot`.
  if (chain.seenProposerPreferences.isKnown(proposalSlot, validatorIndex)) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.ALREADY_KNOWN,
      proposalSlot,
      validatorIndex,
    });
  }

  // [REJECT] `signed_proposer_preferences.signature` is valid with respect to the validator's public key.
  const validatorPubkey = chain.pubkeyCache.get(validatorIndex);
  if (!validatorPubkey) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_SIGNATURE,
      proposalSlot,
      validatorIndex,
    });
  }

  const signatureSet = createSingleSignatureSetFromComponents(
    validatorPubkey,
    getProposerPreferencesSigningRoot(chain.config, preferences),
    signedProposerPreferences.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true, priority: prioritizeBls}))) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_SIGNATURE,
      proposalSlot,
      validatorIndex,
    });
  }

  // Valid
  chain.seenProposerPreferences.add(proposalSlot, validatorIndex);
}
