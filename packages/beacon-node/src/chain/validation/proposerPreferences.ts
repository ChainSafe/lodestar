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

/**
 * Validates a gossiped `SignedProposerPreferences` per
 * https://github.com/ethereum/consensus-specs/blob/master/specs/gloas/p2p-interface.md#proposer_preferences
 */
export async function validateGossipProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<void> {
  const preferences = signedProposerPreferences.message;
  const {proposalSlot, validatorIndex} = preferences;
  const proposalEpoch = computeEpochAtSlot(proposalSlot);

  // [IGNORE] `preferences.proposal_slot` is in the current or next epoch.
  const currentEpoch = chain.clock.currentEpoch;
  if (proposalEpoch < currentEpoch || proposalEpoch > currentEpoch + 1) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.INVALID_EPOCH,
      proposalSlot,
      currentEpoch,
    });
  }

  // [IGNORE] `preferences.proposal_slot` has not already passed.
  const currentSlot = chain.clock.currentSlot;
  if (proposalSlot <= currentSlot) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.PROPOSAL_SLOT_PASSED,
      proposalSlot,
      currentSlot,
    });
  }

  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipProposerPreferences);
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for proposer preferences validation, got fork=${state.forkName}`);
  }

  // [IGNORE] (was REJECT before consensus-specs#5164) `preferences.validator_index` is present at
  // the correct slot in the current or next epoch's portion of `state.proposer_lookahead` — i.e.
  // `is_valid_proposal_slot(state, preferences)` returns True. Lodged as IGNORE so that proposers
  // and receivers with diverging head views do not cross-downscore each other.
  const epochOffset = proposalEpoch - state.epoch;
  const proposers = epochOffset === 0 ? state.currentProposers : state.nextProposers;
  const expectedProposer = proposers[proposalSlot % SLOTS_PER_EPOCH];
  if (epochOffset < 0 || epochOffset > 1 || expectedProposer !== validatorIndex) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
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
  const signatureSet = createSingleSignatureSetFromComponents(
    chain.pubkeyCache.getOrThrow(validatorIndex),
    getProposerPreferencesSigningRoot(chain.config, preferences),
    signedProposerPreferences.signature
  );

  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_SIGNATURE,
      proposalSlot,
      validatorIndex,
    });
  }

  // Valid
  chain.seenProposerPreferences.add(proposalSlot, validatorIndex);
}
