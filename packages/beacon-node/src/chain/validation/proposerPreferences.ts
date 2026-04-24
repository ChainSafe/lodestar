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
 *
 * Spec rules (checked below in a slightly different order for performance):
 *   [IGNORE]  proposal_slot epoch in [current, current+1]
 *   [IGNORE]  proposal_slot > state.slot
 *   [REJECT]  is_valid_proposal_slot(state, preferences)
 *   [IGNORE]  first valid message for (validator_index, proposal_slot)
 *   [REJECT]  signature valid w.r.t. validator pubkey
 */
export async function validateGossipProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<void> {
  const preferences = signedProposerPreferences.message;
  const {proposalSlot, validatorIndex} = preferences;

  // [IGNORE] The `signed_proposer_preferences` is the first valid message received from the validator
  // with index `preferences.validator_index` and the given slot `preferences.proposal_slot`.
  // Spec lists this fourth, but checking it first lets us early-exit on duplicate gossip without
  // paying for the state fetch and signature verification below.
  if (chain.seenProposerPreferences.isKnown(proposalSlot, validatorIndex)) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.ALREADY_KNOWN,
      proposalSlot,
      validatorIndex,
    });
  }

  // [IGNORE] `preferences.proposal_slot` has not already passed — i.e. `proposal_slot > state.slot`.
  // Spec uses `state.slot`, but `state.slot` can lag the wall clock during skipped slots or while
  // catching up. Use the node clock for gossip freshness (matches the pattern used by other gossip
  // validators in this repo, e.g. executionPayloadBid).
  const currentSlot = chain.clock.currentSlot;
  if (proposalSlot <= currentSlot) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.PROPOSAL_SLOT_PASSED,
      proposalSlot,
      currentSlot,
    });
  }

  // [IGNORE] `preferences.proposal_slot` is in the current or next epoch — i.e.
  // `compute_epoch_at_slot(proposal_slot)` is in `[current_epoch, current_epoch + 1]`.
  // The lower bound is already enforced by the slot-passed check above (proposalSlot > currentSlot
  // implies proposalEpoch >= currentEpoch). The upper bound is checked against state.epoch after the
  // state fetch below — state is the authoritative source for "current_epoch" in the spec rule.
  const proposalEpoch = computeEpochAtSlot(proposalSlot);

  const state = await chain.getHeadStateAtCurrentEpoch(RegenCaller.validateGossipProposerPreferences);
  if (!isStatePostGloas(state)) {
    throw new Error(`Expected gloas+ state for proposer preferences validation, got fork=${state.forkName}`);
  }

  const epochOffset = proposalEpoch - state.epoch;
  if (epochOffset < 0 || epochOffset > 1) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.INVALID_EPOCH,
      proposalSlot,
      currentEpoch: state.epoch,
    });
  }

  // [REJECT] `preferences.validator_index` is present at the correct slot in the current or next
  // epoch's portion of `state.proposer_lookahead` — i.e. `is_valid_proposal_slot(state, preferences)`
  // returns True.
  const proposers = epochOffset === 0 ? state.currentProposers : state.nextProposers;
  const expectedProposer = proposers[proposalSlot % SLOTS_PER_EPOCH];
  if (expectedProposer !== validatorIndex) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_PROPOSER,
      proposalSlot,
      validatorIndex,
    });
  }

  // [REJECT] `signed_proposer_preferences.signature` is valid with respect to the validator's public key.
  // The validator is guaranteed to exist: it appears in `state.proposer_lookahead` (checked above).
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
