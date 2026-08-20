import {IForkChoice, ProtoBlock} from "@lodestar/fork-choice";
import {GENESIS_EPOCH, GENESIS_SLOT, MIN_SEED_LOOKAHEAD, SLOTS_PER_EPOCH, isForkPostGloas} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  createSingleSignatureSetFromComponents,
  getProposerPreferencesSigningRoot,
} from "@lodestar/state-transition";
import {Epoch, Slot, ValidatorIndex, gloas} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {GossipAction, ProposerPreferencesError, ProposerPreferencesErrorCode} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

/**
 * Validates a gossiped `SignedProposerPreferences` per
 * https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.14/specs/gloas/p2p-interface.md#new-proposer_preferences
 */
export async function validateGossipProposerPreferences(
  chain: IBeaconChain,
  signedProposerPreferences: gloas.SignedProposerPreferences
): Promise<void> {
  const preferences = signedProposerPreferences.message;
  const {proposalSlot, validatorIndex, dependentRoot} = preferences;
  const dependentRootHex = toRootHex(dependentRoot);
  const proposalEpoch = computeEpochAtSlot(proposalSlot);

  // [IGNORE] `preferences.proposal_slot` is in a Gloas or later fork.
  //
  // Not a spec condition. The Gloas topics are subscribed one epoch ahead of the fork, so for that
  // epoch the lookahead check below accepts a `proposal_slot` that is still pre-Gloas. Preferences
  // for such a slot are meaningless as there is no bid auction before Gloas, and consumers that
  // derive the fork from `proposal_slot` cannot represent them with a Gloas-only type.
  const proposalFork = chain.config.getForkName(proposalSlot);
  if (!isForkPostGloas(proposalFork)) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.PRE_GLOAS_PROPOSAL_SLOT,
      proposalSlot,
      proposalFork,
    });
  }

  // [IGNORE] `preferences.proposal_slot` is within the proposer lookahead,
  // allowing for `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
  const currentEpoch = computeEpochAtSlot(chain.clock.currentSlotWithGossipDisparity);
  if (proposalEpoch > currentEpoch + MIN_SEED_LOOKAHEAD) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.INVALID_EPOCH,
      proposalSlot,
      currentEpoch,
    });
  }

  // [IGNORE] `preferences.proposal_slot` has not already passed, i.e. `proposal_slot > current_slot`,
  // allowing for `MAXIMUM_GOSSIP_CLOCK_DISPARITY`.
  if (chain.clock.msFromSlot(proposalSlot) > chain.config.MAXIMUM_GOSSIP_CLOCK_DISPARITY) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.PROPOSAL_SLOT_PASSED,
      proposalSlot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The block with root `dependent_root` has been seen by the node.
  const dependentBlock = chain.forkChoice.getBlockHexDefaultStatus(dependentRootHex);
  if (dependentBlock === null) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.UNKNOWN_DEPENDENT_ROOT,
      proposalSlot,
      dependentRoot: dependentRootHex,
    });
  }

  const dependentEpoch = Math.max(GENESIS_EPOCH, proposalEpoch - MIN_SEED_LOOKAHEAD);
  const dependentRootSlot = getDependentRootSlot(dependentEpoch);

  // [REJECT] The slot of the block with root `preferences.dependent_root` is strictly less than
  // `compute_start_slot_at_epoch(compute_epoch_at_slot(preferences.proposal_slot) - MIN_SEED_LOOKAHEAD)`.
  if (dependentBlock.slot > dependentRootSlot) {
    throw new ProposerPreferencesError(GossipAction.REJECT, {
      code: ProposerPreferencesErrorCode.INVALID_DEPENDENT_ROOT_SLOT,
      dependentRoot: dependentRootHex,
      dependentBlockSlot: dependentBlock.slot,
      dependentRootSlot,
      dependentEpoch,
    });
  }

  // [IGNORE] `is_valid_dependent_root(store, preferences.dependent_root, epoch)` returns `True`,
  // where `epoch` is `compute_epoch_at_slot(preferences.proposal_slot) - MIN_SEED_LOOKAHEAD`.
  if (!isValidDependentRoot(chain.forkChoice, dependentBlock, dependentEpoch)) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.INVALID_DEPENDENT_ROOT,
      dependentRoot: dependentRootHex,
      dependentBlockSlot: dependentBlock.slot,
      dependentEpoch,
    });
  }

  // Resolve the proposer lookahead for the message's branch via head state (fast path) or
  // the previous-root checkpoint state (populated by `processSlotsToNearestCheckpoint` for
  // any imported branch crossing into `dependentEpoch`). The head-state path also handles
  // narrow timing windows where the checkpoint state isn't yet populated.
  const headState = chain.getHeadState();
  let proposers: ValidatorIndex[] | null = null;
  if (headState.epoch === proposalEpoch && headState.currentDecisionRoot === dependentRootHex) {
    proposers = headState.currentProposers;
  } else if (headState.epoch === dependentEpoch && headState.nextDecisionRoot === dependentRootHex) {
    proposers = headState.nextProposers;
  } else {
    // Sync lookup only to not trigger disk reload from gossip input.
    const checkpointState = chain.regen.getCheckpointStateSync({epoch: dependentEpoch, rootHex: dependentRootHex});
    if (checkpointState !== null) {
      // State is at `dependentEpoch`, so proposers for `proposalSlot` (next epoch from
      // the state's perspective) live in `nextProposers`.
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
  if (chain.proposerPreferencesPool.isKnown(proposalSlot, dependentRootHex, validatorIndex)) {
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

  // Repeated check - deals with race-condition between preferences submissions
  if (chain.proposerPreferencesPool.isKnown(proposalSlot, dependentRootHex, validatorIndex)) {
    throw new ProposerPreferencesError(GossipAction.IGNORE, {
      code: ProposerPreferencesErrorCode.ALREADY_KNOWN,
      proposalSlot,
      validatorIndex,
      dependentRoot: dependentRootHex,
    });
  }

  chain.proposerPreferencesPool.add(signedProposerPreferences);
}

/**
 * Check whether `dependentBlock` is a viable shuffling-dependent root for `epoch`:
 * it is before the epoch boundary and either has a direct child at or after
 * the boundary, or is the current fork-choice head.
 */
export function isValidDependentRoot(forkChoice: IForkChoice, dependentBlock: ProtoBlock, epoch: Epoch): boolean {
  const epochStartSlot = computeStartSlotAtEpoch(epoch);
  if (dependentBlock.slot > getDependentRootSlot(epoch)) {
    return false;
  }

  for (const block of forkChoice.getBlockSummariesByParentRoot(dependentBlock.blockRoot)) {
    if (block.slot >= epochStartSlot) {
      return true;
    }
  }

  return dependentBlock.blockRoot === forkChoice.getHeadRoot();
}

/** Return the slot used to select a dependent root for `epoch`, clamped to genesis. */
function getDependentRootSlot(epoch: Epoch): Slot {
  return Math.max(GENESIS_SLOT, computeStartSlotAtEpoch(epoch) - 1);
}
