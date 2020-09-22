import {Slot, Epoch} from "@chainsafe/lodestar-types";

export enum InvalidBlockCode {
  UNKNOWN_PARENT = "UNKNOWN_PARENT",
  FUTURE_SLOT = "FUTURE_SLOT",
  FINALIZED_SLOT = "FINALIZED_SLOT",
  NOT_FINALIZED_DESCENDANT = "NOT_FINALIZED_DESCENDANT",
}

export type InvalidBlock =
  | {
      code: InvalidBlockCode.UNKNOWN_PARENT;
      root: Uint8Array;
    }
  | {
      code: InvalidBlockCode.FUTURE_SLOT;
      currentSlot: Slot;
      blockSlot: Slot;
    }
  | {
      code: InvalidBlockCode.FINALIZED_SLOT;
      finalizedSlot: Slot;
      blockSlot: Slot;
    }
  | {
      code: InvalidBlockCode.NOT_FINALIZED_DESCENDANT;
      finalizedRoot: Uint8Array;
      blockAncestor?: Uint8Array;
    };

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
}

export type InvalidAttestation =
  | {
      code: InvalidAttestationCode.EMPTY_AGGREGATION_BITFIELD;
    }
  | {
      code: InvalidAttestationCode.UNKNOWN_HEAD_BLOCK;
      beaconBlockRoot: Uint8Array;
    }
  | {
      code: InvalidAttestationCode.BAD_TARGET_EPOCH;
      target: Epoch;
      slot: Slot;
    }
  | {
      code: InvalidAttestationCode.UNKNOWN_TARGET_ROOT;
      root: Uint8Array;
    }
  | {
      code: InvalidAttestationCode.FUTURE_EPOCH;
      attestationEpoch: Epoch;
      currentEpoch: Epoch;
    }
  | {
      code: InvalidAttestationCode.PAST_EPOCH;
      attestationEpoch: Epoch;
      currentEpoch: Epoch;
    }
  | {
      code: InvalidAttestationCode.INVALID_TARGET;
      attestation: Uint8Array;
      local: Uint8Array;
    }
  | {
      code: InvalidAttestationCode.ATTESTS_TO_FUTURE_BLOCK;
      block: Slot;
      attestation: Slot;
    };

export enum ForkChoiceErrorCode {
  ERR_INVALID_ATTESTATION = "ERR_INVALID_ATTESTATION",
  ERR_INVALID_BLOCK = "ERR_INVALID_BLOCK",
  ERR_PROTO_ARRAY_ERROR = "ERR_PROTO_ARRAY_ERROR",
  ERR_INVALID_PROTO_ARRAY_BYTES = "ERR_INVALID_PROTO_ARRAY_BYTES",
  ERR_MISSING_PROTO_ARRAY_BLOCK = "ERR_MISSING_PROTO_ARRAY_BLOCK",
  ERR_UNKNOWN_ANCESTOR = "ERR_UNKNOWN_ANCESTOR",
  ERR_INCONSISTENT_ON_TICK = "ERR_INCONSISTENT_ON_TICK",
  ERR_BEACON_STATE_ERROR = "ERR_BEACON_STATE_ERROR",
  ERR_ATTEMPT_TO_REVERT_JUSTIFICATION = "ERR_ATTEMPT_TO_REVERT_JUSTIFICATION",
  ERR_FORK_CHOICE_STORE_ERROR = "ERR_FORK_CHOICE_STORE_ERROR",
  ERR_UNABLE_TO_SET_JUSTIFIED_CHECKPOINT = "ERR_UNABLE_TO_SET_JUSTIFIED_CHECKPOINT",
  ERR_AFTER_BLOCK_FAILED = "ERR_AFTER_BLOCK_FAILED",
}

export type ForkChoiceErrorType =
  | {
      code: ForkChoiceErrorCode.ERR_INVALID_ATTESTATION;
      err: InvalidAttestation;
    }
  | {
      code: ForkChoiceErrorCode.ERR_INVALID_BLOCK;
      err: InvalidBlock;
    }
  | {
      code: ForkChoiceErrorCode.ERR_PROTO_ARRAY_ERROR;
      err: string;
    }
  | {
      code: ForkChoiceErrorCode.ERR_INVALID_PROTO_ARRAY_BYTES;
      err: string;
    }
  | {
      code: ForkChoiceErrorCode.ERR_MISSING_PROTO_ARRAY_BLOCK;
      root: Uint8Array;
    }
  | {
      code: ForkChoiceErrorCode.ERR_UNKNOWN_ANCESTOR;
      ancestorSlot: Slot;
      descendantRoot: Uint8Array;
    }
  | {
      code: ForkChoiceErrorCode.ERR_INCONSISTENT_ON_TICK;
      previousSlot: Slot;
      time: Slot;
    }
  | {
      code: ForkChoiceErrorCode.ERR_BEACON_STATE_ERROR;
      error: Error;
    }
  | {
      code: ForkChoiceErrorCode.ERR_ATTEMPT_TO_REVERT_JUSTIFICATION;
      store: Slot;
      state: Slot;
    }
  | {
      code: ForkChoiceErrorCode.ERR_FORK_CHOICE_STORE_ERROR;
      error: Error;
    }
  | {
      code: ForkChoiceErrorCode.ERR_UNABLE_TO_SET_JUSTIFIED_CHECKPOINT;
      error: Error;
    }
  | {
      code: ForkChoiceErrorCode.ERR_AFTER_BLOCK_FAILED;
      error: Error;
    };

export class ForkChoiceError extends Error {
  type: ForkChoiceErrorType;

  constructor(type: ForkChoiceErrorType) {
    super(type.code);
    this.type = type;
  }
}
