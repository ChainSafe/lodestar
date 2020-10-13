import {CommitteeIndex, Epoch, Slot, ValidatorIndex} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

import {IAttestationJob} from "../interface";

export enum AttestationErrorCode {
  /**
   * The target state cannot be fetched
   */
  ERR_TARGET_STATE_MISSING = "ERR_TARGET_STATE_MISSING",
  /**
   * The attestation is from a slot that is later than the current slot (with respect to the gossip clock disparity).
   */
  ERR_FUTURE_SLOT = "ERR_FUTURE_SLOT",
  /**
   * The attestation is from a slot that is prior to the earliest permissible slot
   * (with respect to the gossip clock disparity).
   */
  ERR_PAST_SLOT = "ERR_PAST_SLOT",
  /**
   * The attestation is from a slot that is out of range.
   */
  ERR_SLOT_OUT_OF_RANGE = "ERR_SLOT_OUT_OF_RANGE",
  /**
   * The attestations aggregation bits were empty when they shouldn't be.
   */
  ERR_EMPTY_AGGREGATION_BITFIELD = "ERR_EMPTY_AGGREGATION_BITFIELD",
  /**
   * The `selection_proof` on the aggregate attestation does not elect it as an aggregator.
   */
  ERR_INVALID_SELECTION_PROOF = "ERR_INVALID_SELECTION_PROOF",
  /**
   * The `selection_proof` on the aggregate attestation selects it as a validator,
   * however the aggregator index is not in the committee for that attestation.
   */
  ERR_AGGREGATOR_NOT_IN_COMMITTEE = "ERR_AGGREGATOR_NOT_IN_COMMITTEE",
  /**
   * The aggregator index refers to a validator index that we have not seen.
   */
  ERR_AGGREGATOR_PUBKEY_UNKNOWN = "ERR_AGGREGATOR_PUBKEY_UNKNOWN",
  /**
   * The attestation has been seen before; either in a block, on the gossip network or from a local validator.
   */
  ERR_ATTESTATION_ALREADY_KNOWN = "ERR_ATTESTATION_ALREADY_KNOWN",
  /**
   * There has already been an aggregation observed for this validator, we refuse to process a second.
   */
  ERR_AGGREGATE_ALREADY_KNOWN = "ERR_AGGREGATE_ALREADY_KNOWN",
  /**
   * The aggregator index is higher than the maximum possible validator count.
   */
  ERR_AGGREGATOR_INDEX_TOO_HIGH = "ERR_AGGREGATOR_INDEX_TOO_HIGH",
  /**
   * The `attestation.data.beacon_block_root` block is unknown.
   */
  ERR_UNKNOWN_HEAD_BLOCK = "ERR_UNKNOWN_HEAD_BLOCK",
  /**
   * The `attestation.data.slot` is not from the same epoch as `data.target.epoch`.
   */
  ERR_BAD_TARGET_EPOCH = "ERR_BAD_TARGET_EPOCH",
  /**
   * The `attestation.data.beaconBlockRoot` is not a descendant of `data.target.root`.
   */
  ERR_HEAD_NOT_TARGET_DESCENDANT = "ERR_HEAD_NOT_TARGET_DESCENDANT",
  /**
   * The target root of the attestation points to a block that we have not verified.
   */
  ERR_UNKNOWN_TARGET_ROOT = "ERR_UNKNOWN_TARGET_ROOT",
  /**
   * A signature on the attestation is invalid.
   */
  ERR_INVALID_SIGNATURE = "ERR_INVALID_SIGNATURE",
  /**
   * There is no committee for the slot and committee index of this attestation
   * and the attestation should not have been produced.
   */
  ERR_NO_COMMITTEE_FOR_SLOT_AND_INDEX = "ERR_NO_COMMITTEE_FOR_SLOT_AND_INDEX",
  /**
   * The unaggregated attestation doesn't have only one aggregation bit set.
   */
  ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET = "ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET",
  /**
   * We have already observed an attestation for the `validator_index` and refuse to process another.
   */
  ERR_PRIOR_ATTESTATION_KNOWN = "ERR_PRIOR_ATTESTATION_KNOWN",
  /**
   * The attestation is for an epoch in the future (with respect to the gossip clock disparity).
   */
  ERR_FUTURE_EPOCH = "ERR_FUTURE_EPOCH",
  /**
   * The attestation is for an epoch in the past (with respect to the gossip clock disparity).
   */
  ERR_PAST_EPOCH = "ERR_PAST_EPOCH",
  /**
   * The attestation is attesting to a state that is later than itself. (Viz., attesting to the future).
   */
  ERR_ATTESTS_TO_FUTURE_BLOCK = "ERR_ATTESTS_TO_FUTURE_BLOCK",
  /**
   * The attestation was received on an invalid attestation subnet.
   */
  ERR_INVALID_SUBNET_ID = "ERR_INVALID_SUBNET_ID",
  /**
   * The attestation failed the `state_processing` verification stage.
   */
  ERR_INVALID = "ERR_INVALID",
  /**
   * There was an error whilst processing the attestation. It is not known if it is valid or invalid.
   */
  ERR_BEACON_CHAIN_ERROR = "ERR_BEACON_CHAIN_ERROR",
  /**
   * Number of aggregation bits does not match committee size
   */
  ERR_WRONG_NUMBER_OF_AGGREGATION_BITS = "ERR_WRONG_NUMBER_OF_AGGREGATION_BITS",
  /**
   * Block did not pass validation during block processing.
   */
  ERR_KNOWN_BAD_BLOCK = "ERR_KNOWN_BAD_BLOCK",
  /**
   * The current finalized checkpoint is not an ancestor of the block defined by attestation.data.beacon_block_root.
   */
  ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT = "ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT",
  /**
   * The The attestation target block is not an ancestor of the block named in the LMD vote.
   */
  ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK = "ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK",
  /**
   * Committee index out of range.
   */
  ERR_COMMITTEE_INDEX_OUT_OF_RANGE = "ERR_COMMITTEE_INDEX_OUT_OF_RANGE",
  /**
   * Invalid indexed attestation.
   */
  ERR_INVALID_INDEXED_ATTESTATION = "ERR_INVALID_INDEXED_ATTESTATION",
  /**
   * Missing attestation pre-state.
   */
  ERR_MISSING_ATTESTATION_PRESTATE = "ERR_MISSING_ATTESTATION_PRESTATE",
  /**
   * Invalid aggregator.
   */
  ERR_INVALID_AGGREGATOR = "ERR_INVALID_AGGREGATOR",
}

export type AttestationErrorType =
  | {
      code: AttestationErrorCode.ERR_SLOT_OUT_OF_RANGE;
    }
  | {
      code: AttestationErrorCode.ERR_TARGET_STATE_MISSING;
    }
  | {
      code: AttestationErrorCode.ERR_FUTURE_SLOT;
      attestationSlot: Slot;
      latestPermissibleSlot: Slot;
    }
  | {
      code: AttestationErrorCode.ERR_PAST_SLOT;
      attestationSlot: Slot;
      earliestPermissibleSlot: Slot;
    }
  | {
      code: AttestationErrorCode.ERR_EMPTY_AGGREGATION_BITFIELD;
    }
  | {
      code: AttestationErrorCode.ERR_INVALID_SELECTION_PROOF;
      aggregatorIndex: ValidatorIndex;
    }
  | {
      code: AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE;
      aggregatorIndex: ValidatorIndex;
    }
  | {
      code: AttestationErrorCode.ERR_AGGREGATOR_PUBKEY_UNKNOWN;
      aggregatorIndex: ValidatorIndex;
    }
  | {
      code: AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN;
      root: Uint8Array;
    }
  | {
      code: AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN;
      root: Uint8Array;
    }
  | {
      code: AttestationErrorCode.ERR_AGGREGATOR_INDEX_TOO_HIGH;
      aggregatorIndex: ValidatorIndex;
    }
  | {
      code: AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK;
      beaconBlockRoot: Uint8Array;
    }
  | {
      code: AttestationErrorCode.ERR_BAD_TARGET_EPOCH;
    }
  | {
      code: AttestationErrorCode.ERR_HEAD_NOT_TARGET_DESCENDANT;
    }
  | {
      code: AttestationErrorCode.ERR_UNKNOWN_TARGET_ROOT;
      root: Uint8Array;
    }
  | {
      code: AttestationErrorCode.ERR_INVALID_SIGNATURE;
    }
  | {
      code: AttestationErrorCode.ERR_NO_COMMITTEE_FOR_SLOT_AND_INDEX;
      slot: Slot;
      index: CommitteeIndex;
    }
  | {
      code: AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET;
      numBits: number;
    }
  | {
      code: AttestationErrorCode.ERR_PRIOR_ATTESTATION_KNOWN;
      validatorIndex: ValidatorIndex;
      epoch: Epoch;
    }
  | {
      code: AttestationErrorCode.ERR_FUTURE_EPOCH;
      attestationEpoch: Epoch;
      currentEpoch: Epoch;
    }
  | {
      code: AttestationErrorCode.ERR_PAST_EPOCH;
      attestationEpoch: Epoch;
      currentEpoch: Epoch;
    }
  | {
      code: AttestationErrorCode.ERR_ATTESTS_TO_FUTURE_BLOCK;
      block: Slot;
      attestation: Slot;
    }
  | {
      code: AttestationErrorCode.ERR_INVALID_SUBNET_ID;
      received: number;
      expected: number;
    }
  | {
      code: AttestationErrorCode.ERR_INVALID;
      error: Error;
    }
  | {
      code: AttestationErrorCode.ERR_BEACON_CHAIN_ERROR;
      error: Error;
    }
  | {
      code: AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS;
    }
  | {
      code: AttestationErrorCode.ERR_KNOWN_BAD_BLOCK;
    }
  | {
      code: AttestationErrorCode.ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT;
    }
  | {
      code: AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK;
    }
  | {
      code: AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE;
      index: number;
    }
  | {
      code: AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION;
    }
  | {
      code: AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE;
    }
  | {
      code: AttestationErrorCode.ERR_INVALID_AGGREGATOR;
    };

type IJobObject = {
  job: IAttestationJob;
};

export class AttestationError extends LodestarError<AttestationErrorType> {
  public job: IAttestationJob;

  constructor({job, ...type}: AttestationErrorType & IJobObject) {
    super(type);
    this.job = job;
  }
}
