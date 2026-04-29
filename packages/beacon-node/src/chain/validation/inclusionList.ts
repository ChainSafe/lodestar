import {computeEpochAtSlot, getInclusionListCommittee, getInclusionListSignatureSet} from "@lodestar/state-transition";
import {heze, ssz} from "@lodestar/types";
import {InclusionListSource} from "../blocks/types.js";
import {InclusionListError, InclusionListErrorCode} from "../errors/inclusionList.js";
import {GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";

export enum InvalidInclusionListReason {
  maxSizeExceeded = "max_size_exceeded",
  slotOutOfRange = "slot_out_of_range",
  committeeShuffling = "committee_shuffling",
  validatorNotInCommittee = "validator_not_in_committee",
  seenTwice = "seen_twice",
  invalidSignature = "invalid_signature",
  unknown = "unknown", // TODO HEZE: should be refactored and deleted later
}

export async function validateApiInclusionList(
  chain: IBeaconChain,
  inclusionList: heze.SignedInclusionList
): Promise<void> {
  return validateInclusionList(chain, inclusionList, InclusionListSource.api);
}

export async function validateGossipInclusionList(
  chain: IBeaconChain,
  inclusionList: heze.SignedInclusionList
): Promise<void> {
  return validateInclusionList(chain, inclusionList, InclusionListSource.gossip);
}

async function validateInclusionList(
  chain: IBeaconChain,
  inclusionList: heze.SignedInclusionList,
  source: InclusionListSource
): Promise<void> {
  const {slot, validatorIndex, transactions, inclusionListCommitteeRoot} = inclusionList.message;

  // [REJECT] The size of message is within upperbound MAX_BYTES_PER_INCLUSION_LIST
  // TODO HEZE: spec is outdated, we need to check total size of all transactions
  const inclusionListSize = transactions.reduce((total, transaction) => total + transaction.byteLength, 0);
  if (inclusionListSize > chain.config.MAX_BYTES_PER_INCLUSION_LIST) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.maxSizeExceeded});
    chain.metrics?.inclusionListsInvalidSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED,
      inclusionListSize,
      sizeLimit: chain.config.MAX_BYTES_PER_INCLUSION_LIST,
    });
  }

  // [REJECT] The slot message.slot is equal to the previous or current slot.
  if (slot !== chain.clock.currentSlot && slot !== chain.clock.currentSlot - 1) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.slotOutOfRange});
    chain.metrics?.inclusionListsInvalidSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_SLOT,
      inclusionListSlot: slot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The slot message.slot is equal to the current slot, or it is equal to the previous slot and the current time is less than attestation_deadline seconds into the slot.

  const headState = chain.getHeadState();
  const shuffling = headState.getShufflingAtEpoch(computeEpochAtSlot(slot));
  const inclusionListCommittee = getInclusionListCommittee(shuffling, slot);
  const inclusionListCommitteeRootFromState = ssz.heze.InclusionListCommittee.hashTreeRoot([...inclusionListCommittee]);

  // [IGNORE] The inclusion_list_committee for slot message.slot on the current branch corresponds to message.inclusion_list_committee_root, as determined by hash_tree_root(inclusion_list_committee) == message.inclusion_list_committee_root.
  if (Buffer.compare(inclusionListCommitteeRoot, inclusionListCommitteeRootFromState) !== 0) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.committeeShuffling});
    chain.metrics?.inclusionListsInvalidSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.INVALID_COMMITTEE_ROOT,
      received: inclusionListCommitteeRoot,
      expected: inclusionListCommitteeRootFromState,
    });
  }

  // [REJECT] The validator index message.validator_index is within the inclusion_list_committee corresponding to message.inclusion_list_committee_root.
  if (!inclusionListCommittee.includes(validatorIndex)) {
    chain.metrics?.inclusionListsInvalid.inc({
      source,
      reason: InvalidInclusionListReason.validatorNotInCommittee,
    });
    chain.metrics?.inclusionListsInvalidSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE,
      validatorIndex,
      committee: inclusionListCommittee,
    });
  }

  // TODO HEZE: use a different cache similar to `seenAttesters` here?
  // [IGNORE] The message is either the first or second valid message received from the validator with index message.validator_index.
  if (chain.inclusionListStore.seenTwice(slot, validatorIndex)) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.seenTwice});
    chain.metrics?.inclusionListsInvalidSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.MORE_THAN_TWO,
      validatorIndex,
    });
  }

  // [REJECT] The signature of inclusion_list.signature is valid with respect to the validator index.
  const signatureSet = getInclusionListSignatureSet(chain.config, chain.getHeadState().slot, inclusionList);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    chain.metrics?.inclusionListsInvalid.inc({source, reason: InvalidInclusionListReason.invalidSignature});
    chain.metrics?.inclusionListsInvalidSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_SIGNATURE,
    });
  }

  chain.metrics?.inclusionListsValid.inc({source});
  chain.metrics?.inclusionListsValidSize.inc(inclusionListSize);
}
