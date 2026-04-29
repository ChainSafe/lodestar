import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getProposerPreferencesSigningRoot,
} from "@lodestar/state-transition";
import {gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {GossipAction, ProposerPreferencesError, ProposerPreferencesErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

/**
 * Validates a gossiped `SignedProposerPreferences` per
 * https://github.com/ethereum/consensus-specs/blob/master/specs/gloas/p2p-interface.md#proposer_preferences
 */
export async function validateGossipProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<void> {
  const preferences = signedProposerPreferences.message;
  const {proposalSlot, validatorIndex, dependentRoot} = preferences;
  const dependentRootHex = toRootHex(dependentRoot);
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

  // [IGNORE] The block with root `dependent_root` has been seen by the node.
  // Sync lookup only to not trigger disk reload from gossip input.
  const cpEpoch = proposalEpoch - 1;
  const checkpointState = chain.regen.getCheckpointStateSync({epoch: cpEpoch, rootHex: dependentRootHex});
  if (checkpointState === null) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.UNKNOWN_DEPENDENT_ROOT,
      proposalSlot,
      dependentRoot: dependentRootHex,
    });
  }

  // [REJECT] `is_valid_proposal_slot(state, preferences)` returns True.
  // The checkpoint state is at `proposalEpoch - 1`, so the proposer for `proposalSlot`
  // (which is in the next epoch from the state's perspective) lives in `nextProposers`.
  const expectedProposer = checkpointState.nextProposers[proposalSlot % SLOTS_PER_EPOCH];
  if (expectedProposer !== validatorIndex) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_PROPOSER,
      proposalSlot,
      validatorIndex,
      dependentRoot: dependentRootHex,
    });
  }

  // [IGNORE] First valid message for (dependent_root, proposal_slot, validator_index).
  if (chain.seenProposerPreferences.isKnown(dependentRootHex, proposalSlot, validatorIndex)) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.ALREADY_KNOWN,
      proposalSlot,
      validatorIndex,
      dependentRoot: dependentRootHex,
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
  chain.seenProposerPreferences.add(dependentRootHex, proposalSlot, validatorIndex);
}
