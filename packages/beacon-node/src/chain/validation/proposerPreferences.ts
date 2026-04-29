import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {
  computeEpochAtSlot,
  createSingleSignatureSetFromComponents,
  getProposerPreferencesSigningRoot,
} from "@lodestar/state-transition";
import {ValidatorIndex, gloas} from "@lodestar/types";
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
  // Resolve the proposer lookahead for the message's branch:
  // 1. Fast path: head state already covers `dependent_root` (matches `currentDecisionRoot`
  //    or `nextDecisionRoot`). Avoids a cache lookup and handles narrow timing windows
  //    where the previous-root checkpoint state isn't (yet) populated.
  // 2. Fallback: previous-root checkpoint state at `(proposalEpoch - 1, dependent_root)`,
  //    populated by `processSlotsToNearestCheckpoint` for any imported branch crossing the
  //    boundary into `proposalEpoch - 1`. Sync lookup only — never triggers disk reload.
  const headState = chain.getHeadState();
  let proposers: ValidatorIndex[] | null = null;
  if (headState.epoch === proposalEpoch && headState.currentDecisionRoot === dependentRootHex) {
    proposers = headState.currentProposers;
  } else if (headState.epoch === proposalEpoch - 1 && headState.nextDecisionRoot === dependentRootHex) {
    proposers = headState.nextProposers;
  } else {
    const checkpointState = chain.regen.getCheckpointStateSync({epoch: proposalEpoch - 1, rootHex: dependentRootHex});
    if (checkpointState !== null) {
      proposers = checkpointState.nextProposers;
    }
  }
  if (proposers === null) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.UNKNOWN_DEPENDENT_ROOT,
      proposalSlot,
      dependentRoot: dependentRootHex,
    });
  }

  // [REJECT] `is_valid_proposal_slot(state, preferences)` returns True.
  if (proposers[proposalSlot % SLOTS_PER_EPOCH] !== validatorIndex) {
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
