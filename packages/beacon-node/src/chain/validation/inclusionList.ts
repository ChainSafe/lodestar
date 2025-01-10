import {getInclusionListSignatureSet} from "@lodestar/state-transition";
import {focil} from "@lodestar/types";
import { GossipAction} from "../errors/index.js";
import {IBeaconChain} from "../index.js";
import { InclusionListError, InclusionListErrorCode } from "../errors/inclusionList.js";
import { MAX_TRANSACTIONS_PER_INCLUSION_LIST } from "@lodestar/params";

export async function validateApiInclusionList(
  chain: IBeaconChain,
  inclusionList: focil.SignedInclusionlist,
): Promise<void> {
  return validateInclusionList(chain, inclusionList);
}

export async function validateGossipInclusionList(
  chain: IBeaconChain,
  inclusionList: focil.SignedInclusionlist,
): Promise<void> {
  return validateInclusionList(chain, inclusionList);
}

async function validateInclusionList(
  chain: IBeaconChain,
  inclusionList: focil.SignedInclusionlist,
): Promise<void> {
  const slot = inclusionList.message.slot;
  // [REJECT] The size of message is within upperbound MAX_BYTES_PER_INCLUSION_LIST

  // [REJECT] The slot message.slot is equal to the previous or current slot.
  if (slot !== chain.clock.currentSlot && slot !== chain.clock.currentSlot - 1) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_SLOT,
      inclusionListSlot: slot,
      currentSlot: chain.clock.currentSlot,
    });
  }

  // [IGNORE] The slot message.slot is equal to the current slot, or it is equal to the previous slot and the current time is less than attestation_deadline seconds into the slot.

  // [IGNORE] The inclusion_list_committee for slot message.slot on the current branch corresponds to message.inclusion_list_committee_root, as determined by hash_tree_root(inclusion_list_committee) == message.inclusion_list_committee_root.

  // [REJECT] The validator index message.validator_index is within the inclusion_list_committee corresponding to message.inclusion_list_committee_root.

  // [REJECT] The transactions message.transactions length is within upperbound MAX_TRANSACTIONS_PER_INCLUSION_LIST
  if (inclusionList.message.transactions.length > MAX_TRANSACTIONS_PER_INCLUSION_LIST) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.TOO_MANY_TRANSACTIONS,
      numTransactions: inclusionList.message.transactions.length,
      transactionLimit: MAX_TRANSACTIONS_PER_INCLUSION_LIST,
    });
  }

  // [IGNORE] The message is either the first or second valid message received from the validator with index message.validator_index.

  // [REJECT] The signature of inclusion_list.signature is valid with respect to the validator index.
  const signatureSet = getInclusionListSignatureSet(chain.getHeadState(), inclusionList);
  if (!await chain.bls.verifySignatureSets([signatureSet], {batchable: true})) {
    throw new InclusionListError(GossipAction.REJECT, {
      code: InclusionListErrorCode.INVALID_SIGNATURE,
    });
  }
}
