import {ProtoBlock} from "@lodestar/fork-choice";
import {GENESIS_SLOT, MIN_SEED_LOOKAHEAD, isForkPostHeze} from "@lodestar/params";
import {
  EpochShuffling,
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getInclusionListCommittee,
  getInclusionListSignatureSet,
} from "@lodestar/state-transition";
import {Epoch, RootHex, heze} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {InclusionListError, InclusionListErrorCode} from "../errors/inclusionList.js";
import {GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/index.js";
import {isValidDependentRoot} from "./proposerPreferences.js";

export type InclusionListValidationResult = {
  /** Positions of `validator_index` in `get_inclusion_list_committee(state, slot)`, several when the committee cycles */
  committeeIndices: number[];
  /** Sum of the byte lengths of `message.transactions` */
  totalBytes: number;
};

/**
 * Gossip validation for the `inclusion_list` topic, in spec rule order. Also applied to inclusion lists
 * submitted over the API before they are published.
 */
export async function validateGossipInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList
): Promise<InclusionListValidationResult> {
  const {slot, validatorIndex, transactions, dependentRoot} = signedInclusionList.message;
  const totalBytes = transactions.reduce((total, transaction) => total + transaction.byteLength, 0);

  // A pre-heze slot has no inclusion list committee to validate against
  if (!isForkPostHeze(chain.config.getForkName(slot))) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.PRE_HEZE_SLOT,
      inclusionListSlot: slot,
    });
  }

  // [IGNORE] The message is either the first or second valid message received from validatorIndex
  // for (message.slot, message.dependent_root)
  const dependentRootHex = toRootHex(dependentRoot);
  if (chain.inclusionListStore.seenTwice(slot, dependentRootHex, validatorIndex)) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.MORE_THAN_TWO,
      validatorIndex,
    });
  }

  // [IGNORE] message.slot is equal to the current slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance
  if (!chain.clock.isCurrentSlotGivenGossipDisparity(slot)) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.INVALID_SLOT,
      inclusionListSlot: slot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The size of message.transactions is greater than 0
  if (totalBytes === 0) {
    throw new InclusionListError(GossipAction.IGNORE, {code: InclusionListErrorCode.EMPTY_TRANSACTIONS});
  }

  // [REJECT] The size of message.transactions is within upperbound MAX_TRANSACTIONS_BYTES_PER_INCLUSION_LIST
  if (totalBytes > chain.config.MAX_TRANSACTIONS_BYTES_PER_INCLUSION_LIST) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED,
      totalBytes,
      maxBytes: chain.config.MAX_TRANSACTIONS_BYTES_PER_INCLUSION_LIST,
    });
  }

  // [REJECT] Every transaction in message.transactions is non-empty
  const emptyTransactionIndex = transactions.findIndex((transaction) => transaction.byteLength === 0);
  if (emptyTransactionIndex !== -1) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.EMPTY_TRANSACTION,
      transactionIndex: emptyTransactionIndex,
    });
  }

  // [IGNORE] The block with root message.dependent_root has been seen
  const dependentBlock = chain.forkChoice.getBlockHexDefaultStatus(dependentRootHex);
  if (dependentBlock === null) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.UNKNOWN_DEPENDENT_ROOT,
      dependentRoot: dependentRootHex,
    });
  }

  // [REJECT] The slot of the block with root message.dependent_root is strictly less than
  // compute_start_slot_at_epoch(compute_epoch_at_slot(message.slot) - MIN_SEED_LOOKAHEAD),
  // clamped to genesis like compute_shuffling_dependent_slot
  const epoch = computeEpochAtSlot(slot);
  const dependentEpoch = epoch - MIN_SEED_LOOKAHEAD;
  const maxDependentSlot = Math.max(GENESIS_SLOT, computeStartSlotAtEpoch(dependentEpoch) - 1);
  if (dependentBlock.slot > maxDependentSlot) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_DEPENDENT_ROOT_SLOT,
      dependentRoot: dependentRootHex,
      dependentSlot: dependentBlock.slot,
      maxSlot: maxDependentSlot,
    });
  }

  // [IGNORE] is_valid_dependent_root(store, message.dependent_root, epoch - MIN_SEED_LOOKAHEAD)
  if (!isValidDependentRoot(chain.forkChoice, dependentBlock, dependentEpoch)) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.INVALID_DEPENDENT_ROOT,
      dependentRoot: dependentRootHex,
      epoch: dependentEpoch,
    });
  }

  // [REJECT] validatorIndex is in get_inclusion_list_committee(state, message.slot), where state is the
  // state of the block with root message.dependent_root, i.e. the shuffling of `epoch` keyed by `dependent_root`
  const shuffling = await getShuffling(chain, epoch, dependentRootHex, dependentBlock);
  if (shuffling === null) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.MISSING_SHUFFLING,
      dependentRoot: dependentRootHex,
      epoch,
    });
  }
  const committeeIndices = getInclusionListCommittee(shuffling, slot).getCommitteeIndices(validatorIndex);
  if (committeeIndices.length === 0) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE,
      validatorIndex,
    });
  }

  // [REJECT] The signature is valid with respect to the validator's public key
  // Domain from the list's own slot, so a list for the first Heze slot verifies while the clock is still in Gloas
  const signatureSet = getInclusionListSignatureSet(chain.config, slot, signedInclusionList);
  // With only 16 inclusion list committee members per slot, batching can delay gossip by 100ms.
  // Verify without batching so inclusion lists can be forwarded sooner.
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: false}))) {
    throw new InclusionListError(GossipAction.REJECT, {code: InclusionListErrorCode.INVALID_SIGNATURE});
  }

  // Check again after the async validation so concurrent lists of the same validator cannot all pass
  if (chain.inclusionListStore.seenTwice(slot, dependentRootHex, validatorIndex)) {
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.MORE_THAN_TWO,
      validatorIndex,
    });
  }
  chain.inclusionListStore.markSeen(slot, dependentRootHex, validatorIndex);

  return {committeeIndices, totalBytes};
}

/**
 * The shuffling of `epoch` on the branch of `dependentBlock`. Usually cached from the head state; when the
 * dependent block is the head across empty epochs that state has not reached the lookahead start slot, so
 * the spec's `process_slots` step is a state regen
 */
async function getShuffling(
  chain: IBeaconChain,
  epoch: Epoch,
  dependentRootHex: RootHex,
  dependentBlock: ProtoBlock
): Promise<EpochShuffling | null> {
  const cached = await chain.shufflingCache.get(epoch, dependentRootHex);
  if (cached !== null) {
    return cached;
  }
  try {
    return await chain.regenStateForAttestationVerification(
      epoch,
      dependentRootHex,
      dependentBlock,
      RegenCaller.validateGossipInclusionList
    );
  } catch {
    return null;
  }
}
