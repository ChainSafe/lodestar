import {InclusionListSource} from "@lodestar/fork-choice";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, getInclusionListSignatureSet} from "@lodestar/state-transition";
import {eip7805} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";
import {getShufflingDependentRoot} from "../../util/dependentRoot.js";
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
  unknown = "unknown", // TODO  EIP-7805: should be refactored and deleted later
}

export async function validateApiInclusionList(
  chain: IBeaconChain,
  inclusionList: eip7805.SignedInclusionList,
  metrics: Metrics | null
): Promise<void> {
  return validateInclusionList(chain, inclusionList, InclusionListSource.api, metrics);
}

export async function validateGossipInclusionList(
  chain: IBeaconChain,
  inclusionList: eip7805.SignedInclusionList,
  metrics: Metrics | null
): Promise<void> {
  return validateInclusionList(chain, inclusionList, InclusionListSource.gossip, metrics);
}

async function validateInclusionList(
  chain: IBeaconChain,
  inclusionList: eip7805.SignedInclusionList,
  source: InclusionListSource,
  metrics: Metrics | null
): Promise<void> {
  const {slot, validatorIndex, transactions, inclusionListCommitteeRoot} = inclusionList.message;

  // [REJECT] The size of message is within upperbound MAX_BYTES_PER_INCLUSION_LIST
  // TODO EIP-7805: spec is outdated, we need to check total size of all transactions
  const inclusionListSize = transactions.reduce((total, transaction) => total + transaction.byteLength, 0);
  if (inclusionListSize > chain.config.MAX_BYTES_PER_INCLUSION_LIST) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.maxSizeExceeded});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.MAXIMUM_SIZE_EXCEEDED,
      inclusionListSize,
      sizeLimit: chain.config.MAX_BYTES_PER_INCLUSION_LIST,
    });
  }

  // [REJECT] The slot message.slot is equal to the previous or current slot.
  if (slot !== chain.clock.currentSlot && slot !== chain.clock.currentSlot - 1) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.slotOutOfRange});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_SLOT,
      inclusionListSlot: slot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The slot message.slot is equal to the current slot, or it is equal to the previous slot and the current time is less than attestation_deadline seconds into the slot.

  const headBlock = chain.forkChoice.getHead(); // Head block in current branch
  const headBlockEpoch = computeEpochAtSlot(headBlock.slot);
  const ilEpoch = computeEpochAtSlot(slot);
  const shufflingDependentRoot = getShufflingDependentRoot(chain.forkChoice, ilEpoch, headBlockEpoch, headBlock);
  const shuffling = await chain.shufflingCache.get(ilEpoch, shufflingDependentRoot);

  if (shuffling === null) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.unknown});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new Error("Shuffling not available"); // TODO EIP-7805: Handle shuffling cache miss
  }

  // [IGNORE] The inclusion_list_committee for slot message.slot on the current branch corresponds to message.inclusion_list_committee_root, as determined by hash_tree_root(inclusion_list_committee) == message.inclusion_list_committee_root.
  const inclusionListCommitteeRootFromShuffling = shuffling.inclusionListCommitteeRoots[slot % SLOTS_PER_EPOCH];
  if (Buffer.compare(inclusionListCommitteeRoot, inclusionListCommitteeRootFromShuffling) !== 0) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.committeeShuffling});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.INVALID_COMMITTEE_ROOT,
      received: inclusionListCommitteeRoot,
      expected: inclusionListCommitteeRootFromShuffling,
    });
  }

  // [REJECT] The validator index message.validator_index is within the inclusion_list_committee corresponding to message.inclusion_list_committee_root.
  const inclusionListCommitteeFromShuffling = shuffling.inclusionListCommittees[slot % SLOTS_PER_EPOCH];
  if (!inclusionListCommitteeFromShuffling.includes(validatorIndex)) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.validatorNotInCommittee});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.VALIDATOR_NOT_IN_COMMITTEE,
      validatorIndex,
      committee: inclusionListCommitteeFromShuffling,
    });
  }

  // TODO EIP-7805: use a different cache similar to `seenAttesters` here?
  // [IGNORE] The message is either the first or second valid message received from the validator with index message.validator_index.
  if (chain.inclusionListPool.seenTwice(slot, validatorIndex)) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.seenTwice});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.IGNORE, {
      code: InclusionListErrorCode.MORE_THAN_TWO,
      validatorIndex,
    });
  }

  // [REJECT] The signature of inclusion_list.signature is valid with respect to the validator index.
  const signatureSet = getInclusionListSignatureSet(chain.getHeadState(), inclusionList);
  if (!(await chain.bls.verifySignatureSets([signatureSet], {batchable: true}))) {
    metrics?.eip7805.inclusionListInvalid.inc({source, reason: InvalidInclusionListReason.invalidSignature});
    metrics?.eip7805.invalidInclusionListByteSize.inc(inclusionListSize);
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_SIGNATURE,
    });
  }

  metrics?.eip7805.inclusionListValid.inc({source});
  metrics?.eip7805.validInclusionListByteSize.inc(inclusionListSize);
}
