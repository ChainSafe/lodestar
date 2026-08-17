import {isForkPostHeze} from "@lodestar/params";
import {getInclusionListSignatureSet, isStatePostHeze} from "@lodestar/state-transition";
import {heze, ssz} from "@lodestar/types";
import {byteArrayEquals} from "@lodestar/utils";
import {InclusionListSource} from "../blocks/types.js";
import {InclusionListError, InclusionListErrorCode, InclusionListErrorType} from "../errors/inclusionList.js";
import {GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../interface.js";

export enum InvalidInclusionListReason {
  maxSizeExceeded = "max_size_exceeded",
  slotOutOfRange = "slot_out_of_range",
  seenTwice = "seen_twice",
  validatorNotInCommittee = "validator_not_in_committee",
  committeeRootMismatch = "committee_root_mismatch",
  invalidSignature = "invalid_signature",
  preHezeSlot = "pre_heze_slot",
}

export async function validateApiInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList
): Promise<void> {
  return validateInclusionList(chain, signedInclusionList, InclusionListSource.api);
}

export async function validateGossipInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList
): Promise<void> {
  return validateInclusionList(chain, signedInclusionList, InclusionListSource.gossip);
}

/**
 * Gossip validation for the `inclusion_list` topic, in spec rule order.
 */
async function validateInclusionList(
  chain: IBeaconChain,
  signedInclusionList: heze.SignedInclusionList,
  source: InclusionListSource
): Promise<void> {
  const {slot, validatorIndex, transactions, inclusionListCommitteeRoot} = signedInclusionList.message;

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

  // [IGNORE] message.slot is equal to the current slot, with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance
  if (!chain.clock.isCurrentSlotGivenGossipDisparity(slot)) {
    ignore(InvalidInclusionListReason.slotOutOfRange, {
      code: InclusionListErrorCode.INVALID_SLOT,
      inclusionListSlot: slot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The message is either the first or second valid message received from validatorIndex.
  // Checked before the committee lookups below, which are the expensive part.
  if (chain.inclusionListStore.seenTwice(slot, validatorIndex)) {
    ignore(InvalidInclusionListReason.seenTwice, {
      code: InclusionListErrorCode.MORE_THAN_TWO,
      validatorIndex,
    });
  }

  // Thrown inline rather than via ignore() so the type guard narrows headState below;
  // control-flow analysis does not follow never-returning arrow functions.
  const headState = chain.getHeadState();
  if (!isStatePostHeze(headState)) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.preHezeSlot});
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.PRE_HEZE_SLOT,
      inclusionListSlot: slot,
    });
  }

  const committee = headState.getInclusionListCommittee(slot);

  // [REJECT] validatorIndex is in get_inclusion_list_committee(state, message.slot)
  if (!committee.includes(validatorIndex)) {
    reject(InvalidInclusionListReason.validatorNotInCommittee, {
      code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE,
      validatorIndex,
    });
  }

  // [REJECT] message.inclusionListCommitteeRoot equals hash_tree_root of the local committee
  const expectedCommitteeRoot = ssz.heze.InclusionListCommittee.hashTreeRoot(Array.from(committee));
  if (!byteArrayEquals(inclusionListCommitteeRoot, expectedCommitteeRoot)) {
    reject(InvalidInclusionListReason.committeeRootMismatch, {
      code: InclusionListErrorCode.INVALID_COMMITTEE_ROOT,
      received: inclusionListCommitteeRoot,
      expected: expectedCommitteeRoot,
    });
  }

  // [REJECT] The signature is valid with respect to the validator's public key
  const signatureSet = getInclusionListSignatureSet(chain.config, headState.slot, signedInclusionList);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    reject(InvalidInclusionListReason.invalidSignature, {code: InclusionListErrorCode.INVALID_SIGNATURE});
  }

  chain.metrics?.inclusionListsValid.inc({source});
  chain.metrics?.inclusionListsValidSize.inc(inclusionListSize);
}
