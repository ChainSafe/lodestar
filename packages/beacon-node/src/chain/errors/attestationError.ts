import {toHexString} from "@chainsafe/ssz";
import {Epoch, Slot, ValidatorIndex, RootHex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum AttestationErrorCode {
  /**
   * The target state cannot be fetched
   */
  TARGET_STATE_MISSING = "ATTESTATION_ERROR_TARGET_STATE_MISSING",
  /**
   * The attestation is from a slot that is later than the current slot (with respect to the gossip clock disparity).
   */
  FUTURE_SLOT = "ATTESTATION_ERROR_FUTURE_SLOT",
  /**
   * The attestation is from a slot that is prior to the earliest permissible slot
   * (with respect to the gossip clock disparity).
   */
  PAST_SLOT = "ATTESTATION_ERROR_PAST_SLOT",
  /**
   * The attestations aggregation bits were empty when they shouldn't be.
   */
  EMPTY_AGGREGATION_BITFIELD = "ATTESTATION_ERROR_EMPTY_AGGREGATION_BITFIELD",
  /**
   * The `selection_proof` on the aggregate attestation selects it as a validator,
   * however the aggregator index is not in the committee for that attestation.
   */
  AGGREGATOR_NOT_IN_COMMITTEE = "ATTESTATION_ERROR_AGGREGATOR_NOT_IN_COMMITTEE",
  /**
   * The aggregator index refers to a validator index that we have not seen.
   */
  AGGREGATOR_PUBKEY_UNKNOWN = "ATTESTATION_ERROR_AGGREGATOR_PUBKEY_UNKNOWN",
  /**
   * The attestation has been seen before; either in a block, on the gossip network or from a local validator.
   */
  ATTESTATION_ALREADY_KNOWN = "ATTESTATION_ERROR_ATTESTATION_ALREADY_KNOWN",
  /**
   * There has already been an aggregation observed for this validator, we refuse to process a second.
   */
  AGGREGATOR_ALREADY_KNOWN = "ATTESTATION_ERROR_AGGREGATOR_ALREADY_KNOWN",
  /**
   * All of the attesters are known, we refuse to process subset of attesting indices since it brings no value.
   */
  ATTESTERS_ALREADY_KNOWN = "ATTESTATION_ERROR_ATTESTERS_ALREADY_KNOWN",
  /**
   * The aggregator index is higher than the maximum possible validator count.
   */
  AGGREGATOR_INDEX_TOO_HIGH = "ATTESTATION_ERROR_AGGREGATOR_INDEX_TOO_HIGH",
  /**
   * The `attestation.data.beacon_block_root` block is unknown or prefinalized.
   */
  UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT = "ATTESTATION_ERROR_UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT",
  /**
   * The `attestation.data.slot` is not from the same epoch as `data.target.epoch`.
   */
  BAD_TARGET_EPOCH = "ATTESTATION_ERROR_BAD_TARGET_EPOCH",
  /**
   * The `attestation.data.beaconBlockRoot` is not a descendant of `data.target.root`.
   */
  HEAD_NOT_TARGET_DESCENDANT = "ATTESTATION_ERROR_HEAD_NOT_TARGET_DESCENDANT",
  /**
   * The target root of the attestation points to a block that we have not verified.
   */
  UNKNOWN_TARGET_ROOT = "ATTESTATION_ERROR_UNKNOWN_TARGET_ROOT",
  /**
   * A signature on the attestation is invalid.
   */
  INVALID_SIGNATURE = "ATTESTATION_ERROR_INVALID_SIGNATURE",
  /**
   * The unaggregated attestation doesn't have only one aggregation bit set.
   */
  NOT_EXACTLY_ONE_AGGREGATION_BIT_SET = "ATTESTATION_ERROR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET",
  /**
   * We have already observed an attestation for the `validator_index` and refuse to process another.
   */
  PRIOR_ATTESTATION_KNOWN = "ATTESTATION_ERROR_PRIOR_ATTESTATION_KNOWN",
  /**
   * The attestation is for an epoch in the future (with respect to the gossip clock disparity).
   */
  FUTURE_EPOCH = "ATTESTATION_ERROR_FUTURE_EPOCH",
  /**
   * The attestation is for an epoch in the past (with respect to the gossip clock disparity).
   */
  PAST_EPOCH = "ATTESTATION_ERROR_PAST_EPOCH",
  /**
   * The attestation is attesting to a state that is later than itself. (Viz., attesting to the future).
   */
  ATTESTS_TO_FUTURE_BLOCK = "ATTESTATION_ERROR_ATTESTS_TO_FUTURE_BLOCK",
  /**
   * The attestation was received on an invalid attestation subnet.
   */
  INVALID_SUBNET_ID = "ATTESTATION_ERROR_INVALID_SUBNET_ID",
  /**
   * Number of aggregation bits does not match committee size
   */
  WRONG_NUMBER_OF_AGGREGATION_BITS = "ATTESTATION_ERROR_WRONG_NUMBER_OF_AGGREGATION_BITS",
  /**
   * Block did not pass validation during block processing.
   */
  KNOWN_BAD_BLOCK = "ATTESTATION_ERROR_KNOWN_BAD_BLOCK",
  /**
   * The current finalized checkpoint is not an ancestor of the block defined by attestation.data.beacon_block_root.
   */
  INVALID_TARGET_ROOT = "ATTESTATION_ERROR_INVALID_TARGET_ROOT",
  /**
   * The The attestation target block is not an ancestor of the block named in the LMD vote.
   */
  TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK = "ATTESTATION_ERROR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK",
  /**
   * Committee index out of range.
   */
  COMMITTEE_INDEX_OUT_OF_RANGE = "ATTESTATION_ERROR_COMMITTEE_INDEX_OUT_OF_RANGE",
  /**
   * Missing state to verify attestation
   */
  MISSING_STATE_TO_VERIFY_ATTESTATION = "ATTESTATION_ERROR_MISSING_STATE_TO_VERIFY_ATTESTATION",
  /**
   * Invalid aggregator.
   */
  INVALID_AGGREGATOR = "ATTESTATION_ERROR_INVALID_AGGREGATOR",
  /**
   * Invalid attestation indexes: not sorted or unique
   */
  INVALID_INDEXED_ATTESTATION = "ATTESTATION_ERROR_INVALID_INDEXED_ATTESTATION",
  /**
   * Invalid ssz bytes.
   */
  INVALID_SERIALIZED_BYTES = "ATTESTATION_ERROR_INVALID_SERIALIZED_BYTES",
  /** Too many skipped slots. */
  TOO_MANY_SKIPPED_SLOTS = "ATTESTATION_ERROR_TOO_MANY_SKIPPED_SLOTS",
}

export type AttestationErrorType =
  | {code: AttestationErrorCode.TARGET_STATE_MISSING}
  | {code: AttestationErrorCode.FUTURE_SLOT; attestationSlot: Slot; latestPermissibleSlot: Slot}
  | {code: AttestationErrorCode.PAST_SLOT; attestationSlot: Slot; earliestPermissibleSlot: Slot}
  | {code: AttestationErrorCode.EMPTY_AGGREGATION_BITFIELD}
  | {code: AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE}
  | {code: AttestationErrorCode.AGGREGATOR_PUBKEY_UNKNOWN; aggregatorIndex: ValidatorIndex}
  | {code: AttestationErrorCode.ATTESTATION_ALREADY_KNOWN; targetEpoch: Epoch; validatorIndex: number}
  | {code: AttestationErrorCode.AGGREGATOR_ALREADY_KNOWN; targetEpoch: Epoch; aggregatorIndex: number}
  | {code: AttestationErrorCode.ATTESTERS_ALREADY_KNOWN; targetEpoch: Epoch; aggregateRoot: RootHex}
  | {code: AttestationErrorCode.AGGREGATOR_INDEX_TOO_HIGH; aggregatorIndex: ValidatorIndex}
  | {code: AttestationErrorCode.UNKNOWN_OR_PREFINALIZED_BEACON_BLOCK_ROOT; root: RootHex}
  | {code: AttestationErrorCode.BAD_TARGET_EPOCH}
  | {code: AttestationErrorCode.HEAD_NOT_TARGET_DESCENDANT}
  | {code: AttestationErrorCode.UNKNOWN_TARGET_ROOT; root: Uint8Array}
  | {code: AttestationErrorCode.INVALID_SIGNATURE}
  | {code: AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET}
  | {code: AttestationErrorCode.PRIOR_ATTESTATION_KNOWN; validatorIndex: ValidatorIndex; epoch: Epoch}
  | {code: AttestationErrorCode.FUTURE_EPOCH; attestationEpoch: Epoch; currentEpoch: Epoch}
  | {code: AttestationErrorCode.PAST_EPOCH; attestationEpoch: Epoch; previousEpoch: Epoch}
  | {code: AttestationErrorCode.ATTESTS_TO_FUTURE_BLOCK; block: Slot; attestation: Slot}
  | {code: AttestationErrorCode.INVALID_SUBNET_ID; received: number; expected: number}
  | {code: AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS}
  | {code: AttestationErrorCode.KNOWN_BAD_BLOCK}
  | {code: AttestationErrorCode.INVALID_TARGET_ROOT; targetRoot: RootHex; expected: string | null}
  | {code: AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK}
  | {code: AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE; index: number}
  | {code: AttestationErrorCode.MISSING_STATE_TO_VERIFY_ATTESTATION; error: Error}
  | {code: AttestationErrorCode.INVALID_AGGREGATOR}
  | {code: AttestationErrorCode.INVALID_INDEXED_ATTESTATION}
  | {code: AttestationErrorCode.INVALID_SERIALIZED_BYTES}
  | {code: AttestationErrorCode.TOO_MANY_SKIPPED_SLOTS; headBlockSlot: Slot; attestationSlot: Slot};

export class AttestationError extends GossipActionError<AttestationErrorType> {
  getMetadata(): Record<string, string | number | null> {
    const type = this.type;
    switch (type.code) {
      case AttestationErrorCode.UNKNOWN_TARGET_ROOT:
        return {code: type.code, root: toHexString(type.root)};
      case AttestationErrorCode.MISSING_STATE_TO_VERIFY_ATTESTATION:
        // TODO: The stack trace gets lost here
        return {code: type.code, error: type.error.message};

      default:
        return type;
    }
  }
}
