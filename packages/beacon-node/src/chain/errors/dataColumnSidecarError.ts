import {RootHex, Slot, SubnetID} from "@lodestar/types";
import {LodestarError} from "@lodestar/utils";
import {GossipActionError} from "./gossipValidation.js";

export enum DataColumnSidecarErrorCode {
  INVALID_INDEX = "DATA_COLUMN_SIDECAR_ERROR_INVALID_INDEX",
  NO_COMMITMENTS = "DATA_COLUMN_SIDECAR_ERROR_NO_COMMITMENTS",
  MISMATCHED_LENGTHS = "DATA_COLUMN_SIDECAR_ERROR_MISMATCHED_LENGTHS",
  INVALID_SUBNET = "DATA_COLUMN_SIDECAR_ERROR_INVALID_SUBNET",
  INVALID_KZG_PROOF = "DATA_COLUMN_SIDECAR_ERROR_INVALID_KZG_PROOF",
  TOO_MANY_KZG_COMMITMENTS = "DATA_COLUMN_SIDECAR_ERROR_TOO_MANY_KZG_COMMITMENTS",

  // Validation errors when validating against an existing block

  /** Block and sidecars header root mismatch */
  INCORRECT_HEADER_ROOT = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_HEADER_ROOT",
  /** Block and sidecars data column count mismatch */
  INCORRECT_SIDECAR_COUNT = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_SIDECAR_COUNT",
  /** Sidecar doesn't match block */
  INCORRECT_BLOCK = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_BLOCK",
  /** Sidecar cell count not as expected */
  INCORRECT_CELL_COUNT = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_CELL_COUNT",
  /** Sidecar kzg proof count not as expected */
  INCORRECT_KZG_COMMITMENTS_COUNT = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_KZG_COMMITMENTS_COUNT",
  /** Sidecar kzg proof count not as expected */
  INCORRECT_KZG_PROOF_COUNT = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_KZG_PROOF_COUNT",
  /** Sidecars proofs not valid */
  INVALID_KZG_PROOF_BATCH = "DATA_COLUMN_SIDECAR_ERROR_INVALID_KZG_PROOF_BATCH",

  // following errors are adapted from the block errors
  ALREADY_KNOWN = "DATA_COLUMN_SIDECAR_ERROR_ALREADY_KNOWN",
  FUTURE_SLOT = "DATA_COLUMN_SIDECAR_ERROR_FUTURE_SLOT",
  WOULD_REVERT_FINALIZED_SLOT = "DATA_COLUMN_SIDECAR_ERROR_WOULD_REVERT_FINALIZED_SLOT",
  PARENT_UNKNOWN = "DATA_COLUMN_SIDECAR_ERROR_PARENT_UNKNOWN",
  NOT_LATER_THAN_PARENT = "DATA_COLUMN_SIDECAR_ERROR_NOT_LATER_THAN_PARENT",
  PROPOSAL_SIGNATURE_INVALID = "DATA_COLUMN_SIDECAR_ERROR_PROPOSAL_SIGNATURE_INVALID",
  INCLUSION_PROOF_INVALID = "DATA_COLUMN_SIDECAR_ERROR_INCLUSION_PROOF_INVALID",
  INCORRECT_PROPOSER = "DATA_COLUMN_SIDECAR_ERROR_INCORRECT_PROPOSER",
}

export type DataColumnSidecarErrorType =
  | {code: DataColumnSidecarErrorCode.INVALID_INDEX; slot: Slot; columnIndex: number}
  | {code: DataColumnSidecarErrorCode.NO_COMMITMENTS; slot: Slot; columnIndex: number}
  | {
      code: DataColumnSidecarErrorCode.MISMATCHED_LENGTHS;
      columnLength: number;
      commitmentsLength: number;
      proofsLength: number;
    }
  | {code: DataColumnSidecarErrorCode.INVALID_SUBNET; columnIndex: number; gossipSubnet: SubnetID}
  | {
      code: DataColumnSidecarErrorCode.TOO_MANY_KZG_COMMITMENTS;
      slot: number;
      columnIndex: number;
      count: number;
      limit: number;
    }
  | {code: DataColumnSidecarErrorCode.ALREADY_KNOWN; columnIndex: number; slot: Slot}
  | {code: DataColumnSidecarErrorCode.FUTURE_SLOT; blockSlot: Slot; currentSlot: Slot}
  | {code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT; blockSlot: Slot; finalizedSlot: Slot}
  | {
      code: DataColumnSidecarErrorCode.PARENT_UNKNOWN;
      parentRoot: RootHex;
      slot: Slot;
    }
  | {
      code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID;
      slot: Slot;
      blockRoot: RootHex;
      index: number;
    }
  | {code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT; parentSlot: Slot; slot: Slot}
  | {code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID; slot: Slot; columnIndex: number}
  | {code: DataColumnSidecarErrorCode.INVALID_KZG_PROOF; slot: Slot; columnIndex: number}
  | {code: DataColumnSidecarErrorCode.INCORRECT_SIDECAR_COUNT; slot: number; expected: number; actual: number}
  | {
      code: DataColumnSidecarErrorCode.INCORRECT_BLOCK;
      slot: number;
      columnIndex: number;
      expected: string;
      actual: string;
    }
  | {
      code: DataColumnSidecarErrorCode.INCORRECT_HEADER_ROOT;
      slot: number;
      expected: string;
      actual: string;
    }
  | {
      code:
        | DataColumnSidecarErrorCode.INCORRECT_CELL_COUNT
        | DataColumnSidecarErrorCode.INCORRECT_KZG_COMMITMENTS_COUNT
        | DataColumnSidecarErrorCode.INCORRECT_KZG_PROOF_COUNT;
      slot: number;
      columnIndex: number;
      expected: number;
      actual: number;
    }
  | {code: DataColumnSidecarErrorCode.INVALID_KZG_PROOF_BATCH; slot: number; reason: string}
  | {code: DataColumnSidecarErrorCode.INCORRECT_PROPOSER; actualProposerIndex: number; expectedProposerIndex: number};

export class DataColumnSidecarGossipError extends GossipActionError<DataColumnSidecarErrorType> {}
export class DataColumnSidecarValidationError extends LodestarError<DataColumnSidecarErrorType> {}
