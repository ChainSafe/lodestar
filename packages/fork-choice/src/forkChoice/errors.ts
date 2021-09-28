import {Slot, Epoch, RootHex} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

export enum InvalidBlockCode {
  UNKNOWN_PARENT = "UNKNOWN_PARENT",
  FUTURE_SLOT = "FUTURE_SLOT",
  FINALIZED_SLOT = "FINALIZED_SLOT",
  NOT_FINALIZED_DESCENDANT = "NOT_FINALIZED_DESCENDANT",
}

export type InvalidBlock =
  | {code: InvalidBlockCode.UNKNOWN_PARENT; root: RootHex}
  | {code: InvalidBlockCode.FUTURE_SLOT; currentSlot: Slot; blockSlot: Slot}
  | {code: InvalidBlockCode.FINALIZED_SLOT; finalizedSlot: Slot; blockSlot: Slot}
  | {code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT; finalizedRoot: RootHex; blockAncestor?: RootHex};

export enum InvalidAttestationCode {
  /**
   * The attestations aggregation bits were empty when they shouldn't be.
   */
  EMPTY_AGGREGATION_BITFIELD = "EMPTY_AGGREGATION_BITFIELD",
  /**
   * The `attestation.data.beacon_block_root` block is unknown.
   */
  UNKNOWN_HEAD_BLOCK = "UNKNOWN_HEAD_BLOCK",
  /**
   * The `attestation.data.slot` is not from the same epoch as `data.target.epoch` and therefore
   * the attestation is invalid.
   */
  BAD_TARGET_EPOCH = "BAD_TARGET_EPOCH",
  /**
   * The target root of the attestation points to a block that we have not verified.
   */
  UNKNOWN_TARGET_ROOT = "UNKNOWN_TARGET_ROOT",
  /**
   * The attestation is for an epoch in the future (with respect to the gossip clock disparity).
   */
  FUTURE_EPOCH = "FUTURE_EPOCH",
  /**
   * The attestation is for an epoch in the past (with respect to the gossip clock disparity).
   */
  PAST_EPOCH = "PAST_EPOCH",
  /**
   * The attestation references a target root that does not match what is stored in our database.
   */
  INVALID_TARGET = "INVALID_TARGET",
  /**
   * The attestation is attesting to a state that is later than itself. (Viz., attesting to the future).
   */
  ATTESTS_TO_FUTURE_BLOCK = "ATTESTS_TO_FUTURE_BLOCK",
  /**
   * Attestations can only affect the fork choice of subsequent slots.
   * Delay consideration in the fork choice until their slot is in the past.
   */
  FUTURE_SLOT = "FUTURE_SLOT",
}

export type InvalidAttestation =
  | {code: InvalidAttestationCode.EMPTY_AGGREGATION_BITFIELD}
  | {code: InvalidAttestationCode.UNKNOWN_HEAD_BLOCK; beaconBlockRoot: RootHex}
  | {code: InvalidAttestationCode.BAD_TARGET_EPOCH; target: Epoch; slot: Slot}
  | {code: InvalidAttestationCode.UNKNOWN_TARGET_ROOT; root: RootHex}
  | {code: InvalidAttestationCode.FUTURE_EPOCH; attestationEpoch: Epoch; currentEpoch: Epoch}
  | {code: InvalidAttestationCode.PAST_EPOCH; attestationEpoch: Epoch; currentEpoch: Epoch}
  | {code: InvalidAttestationCode.INVALID_TARGET; attestation: RootHex; local: RootHex}
  | {code: InvalidAttestationCode.ATTESTS_TO_FUTURE_BLOCK; block: Slot; attestation: Slot}
  | {code: InvalidAttestationCode.FUTURE_SLOT; attestationSlot: Slot; latestPermissibleSlot: Slot};

export enum ForkChoiceErrorCode {
  INVALID_ATTESTATION = "FORKCHOICE_ERROR_INVALID_ATTESTATION",
  INVALID_BLOCK = "FORKCHOICE_ERROR_INVALID_BLOCK",
  PROTO_ARRAY_ERROR = "FORKCHOICE_ERROR_PROTO_ARRAY_ERROR",
  INVALID_PROTO_ARRAY_BYTES = "FORKCHOICE_ERROR_INVALID_PROTO_ARRAY_BYTES",
  MISSING_PROTO_ARRAY_BLOCK = "FORKCHOICE_ERROR_MISSING_PROTO_ARRAY_BLOCK",
  UNKNOWN_ANCESTOR = "FORKCHOICE_ERROR_UNKNOWN_ANCESTOR",
  INCONSISTENT_ON_TICK = "FORKCHOICE_ERROR_INCONSISTENT_ON_TICK",
  BEACON_STATE_ERROR = "FORKCHOICE_ERROR_BEACON_STATE_ERROR",
  ATTEMPT_TO_REVERT_JUSTIFICATION = "FORKCHOICE_ERROR_ATTEMPT_TO_REVERT_JUSTIFICATION",
  FORK_CHOICE_STORE_ERROR = "FORKCHOICE_ERROR_FORK_CHOICE_STORE_ERROR",
  UNABLE_TO_SET_JUSTIFIED_CHECKPOINT = "FORKCHOICE_ERROR_UNABLE_TO_SET_JUSTIFIED_CHECKPOINT",
  AFTER_BLOCK_FAILED = "FORKCHOICE_ERROR_AFTER_BLOCK_FAILED",
}

export type ForkChoiceErrorType =
  | {code: ForkChoiceErrorCode.INVALID_ATTESTATION; err: InvalidAttestation}
  | {code: ForkChoiceErrorCode.INVALID_BLOCK; err: InvalidBlock}
  | {code: ForkChoiceErrorCode.PROTO_ARRAY_ERROR; err: string}
  | {code: ForkChoiceErrorCode.INVALID_PROTO_ARRAY_BYTES; err: string}
  | {code: ForkChoiceErrorCode.MISSING_PROTO_ARRAY_BLOCK; root: RootHex}
  | {code: ForkChoiceErrorCode.UNKNOWN_ANCESTOR; ancestorSlot: Slot; descendantRoot: RootHex}
  | {code: ForkChoiceErrorCode.INCONSISTENT_ON_TICK; previousSlot: Slot; time: Slot}
  | {code: ForkChoiceErrorCode.BEACON_STATE_ERROR; error: Error}
  | {code: ForkChoiceErrorCode.ATTEMPT_TO_REVERT_JUSTIFICATION; store: Slot; state: Slot}
  | {code: ForkChoiceErrorCode.FORK_CHOICE_STORE_ERROR; error: Error}
  | {code: ForkChoiceErrorCode.UNABLE_TO_SET_JUSTIFIED_CHECKPOINT; error: Error}
  | {code: ForkChoiceErrorCode.AFTER_BLOCK_FAILED; error: Error};

export class ForkChoiceError extends LodestarError<ForkChoiceErrorType> {
  constructor(type: ForkChoiceErrorType) {
    super(type);
  }
}
