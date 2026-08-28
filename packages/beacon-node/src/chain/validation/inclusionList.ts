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
import {InclusionListSource} from "../blocks/types.js";
import {InclusionListError, InclusionListErrorCode, InclusionListErrorType} from "../errors/inclusionList.js";
import {GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/index.js";
import {isValidDependentRoot} from "./proposerPreferences.js";

export enum InvalidInclusionListReason {
  maxSizeExceeded = "max_size_exceeded",
  emptyTransaction = "empty_transaction",
  slotOutOfRange = "slot_out_of_range",
  seenTwice = "seen_twice",
  unknownDependentRoot = "unknown_dependent_root",
  invalidDependentRootSlot = "invalid_dependent_root_slot",
  invalidDependentRoot = "invalid_dependent_root",
  missingShuffling = "missing_shuffling",
  validatorNotInCommittee = "validator_not_in_committee",
  invalidSignature = "invalid_signature",
  preHezeSlot = "pre_heze_slot",
}

export type InclusionListValidationResult = {
  /** Position of `validator_index` in `get_inclusion_list_committee(state, slot)` */
  committeeIndex: number;
};

export async function validateApiInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList
): Promise<InclusionListValidationResult> {
  return validateInclusionList(chain, signedInclusionList, InclusionListSource.api);
}

export async function validateGossipInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList
): Promise<InclusionListValidationResult> {
  return validateInclusionList(chain, signedInclusionList, InclusionListSource.gossip);
}

/**
 * Gossip validation for the `inclusion_list` topic, in spec rule order.
 */
async function validateInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList,
  source: InclusionListSource
): Promise<InclusionListValidationResult> {
  const {slot, validatorIndex, transactions, dependentRoot} = signedInclusionList.message;

  const inclusionListSize = transactions.reduce((total, transaction) => total + transaction.byteLength, 0);
  const reject = (reason: InvalidInclusionListReason, type: InclusionListErrorType): never => {
    chain.metrics?.inclusionListsInvalid.inc({source, reason});
    throw new InclusionListError(GossipAction.REJECT, type);
  };
  const ignore = (reason: InvalidInclusionListReason, type: InclusionListErrorType): never => {
    chain.metrics?.inclusionListsInvalid.inc({source, reason});
    throw new InclusionListError(GossipAction.IGNORE, type);
  };

  // Inclusion lists only exist post-heze; a pre-heze slot has no committee to validate against
  if (!isForkPostHeze(chain.config.getForkName(slot))) {
    ignore(InvalidInclusionListReason.preHezeSlot, {
      code: InclusionListErrorCode.PRE_HEZE_SLOT,
      inclusionListSlot: slot,
    });
  }

  // [REJECT] The size of message.transactions is within upperbound MAX_BYTES_PER_INCLUSION_LIST
  if (inclusionListSize > chain.config.MAX_BYTES_PER_INCLUSION_LIST) {
    reject(InvalidInclusionListReason.maxSizeExceeded, {
      code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED,
      inclusionListSize,
      sizeLimit: chain.config.MAX_BYTES_PER_INCLUSION_LIST,
    });
  }

  // [REJECT] Every transaction in message.transactions is non-empty
  if (transactions.some((transaction) => transaction.byteLength === 0)) {
    reject(InvalidInclusionListReason.emptyTransaction, {code: InclusionListErrorCode.EMPTY_TRANSACTION});
  }

  // [IGNORE] message.slot is equal to the current slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance
  if (!chain.clock.isCurrentSlotGivenGossipDisparity(slot)) {
    ignore(InvalidInclusionListReason.slotOutOfRange, {
      code: InclusionListErrorCode.INVALID_SLOT,
      inclusionListSlot: slot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The message is either the first or second valid message received from validatorIndex.
  // Checked before the dependent root and committee lookups below, which are the expensive part.
  if (chain.inclusionListStore.seenTwice(slot, validatorIndex)) {
    ignore(InvalidInclusionListReason.seenTwice, {
      code: InclusionListErrorCode.MORE_THAN_TWO,
      validatorIndex,
    });
  }

  // [IGNORE] The block with root message.dependent_root has been seen
  const dependentRootHex = toRootHex(dependentRoot);
  // Thrown inline rather than via ignore() so the type guard narrows dependentBlock below;
  // control-flow analysis does not follow never-returning arrow functions.
  const dependentBlock = chain.forkChoice.getBlockHexDefaultStatus(dependentRootHex);
  if (dependentBlock === null) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.unknownDependentRoot});
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.UNKNOWN_DEPENDENT_ROOT,
      dependentRoot: dependentRootHex,
    });
  }

  // [REJECT] The slot of the block with root message.dependent_root is strictly less than
  // compute_start_slot_at_epoch(compute_epoch_at_slot(message.slot) - MIN_SEED_LOOKAHEAD).
  // Clamped to genesis like compute_shuffling_dependent_slot, which returns GENESIS_SLOT for the
  // first MIN_SEED_LOOKAHEAD epochs.
  const epoch = computeEpochAtSlot(slot);
  const dependentEpoch = epoch - MIN_SEED_LOOKAHEAD;
  const maxDependentSlot = Math.max(GENESIS_SLOT, computeStartSlotAtEpoch(dependentEpoch) - 1);
  if (dependentBlock.slot > maxDependentSlot) {
    reject(InvalidInclusionListReason.invalidDependentRootSlot, {
      code: InclusionListErrorCode.INVALID_DEPENDENT_ROOT_SLOT,
      dependentRoot: dependentRootHex,
      dependentSlot: dependentBlock.slot,
      maxSlot: maxDependentSlot,
    });
  }

  // [IGNORE] is_valid_dependent_root(store, message.dependent_root, epoch - MIN_SEED_LOOKAHEAD)
  if (!isValidDependentRoot(chain.forkChoice, dependentBlock, dependentEpoch)) {
    ignore(InvalidInclusionListReason.invalidDependentRoot, {
      code: InclusionListErrorCode.INVALID_DEPENDENT_ROOT,
      dependentRoot: dependentRootHex,
      epoch: dependentEpoch,
    });
  }

  // [REJECT] validatorIndex is in get_inclusion_list_committee(state, message.slot), where state is the
  // state of the block with root message.dependent_root processed up to message.slot. That committee is
  // the shuffling of `epoch` keyed by `dependent_root`.
  const shuffling = await getShuffling(chain, epoch, dependentRootHex, dependentBlock);
  if (shuffling === null) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.missingShuffling});
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.MISSING_SHUFFLING,
      dependentRoot: dependentRootHex,
      epoch,
    });
  }
  const committeeIndex = getInclusionListCommittee(shuffling, slot).indexOf(validatorIndex);
  if (committeeIndex === -1) {
    reject(InvalidInclusionListReason.validatorNotInCommittee, {
      code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE,
      validatorIndex,
    });
  }

  // [REJECT] The signature is valid with respect to the validator's public key
  const signatureSet = getInclusionListSignatureSet(chain.config, chain.clock.currentSlot, signedInclusionList);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    reject(InvalidInclusionListReason.invalidSignature, {code: InclusionListErrorCode.INVALID_SIGNATURE});
  }

  chain.metrics?.inclusionListsValid.inc({source});
  chain.metrics?.inclusionListsValidSize.inc(inclusionListSize);

  return {committeeIndex};
}

/**
 * The shuffling of `epoch` on the branch of `dependentBlock`. Head states populate the cache with
 * their current and next shufflings, so this only regenerates on a branch the head has not seen.
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
