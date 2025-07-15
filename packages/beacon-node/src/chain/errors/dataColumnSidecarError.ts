import {RootHex, Slot} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum DataColumnSidecarErrorCode {
  INVALID_INDEX = "DATA_COLUMN_SIDECAR_ERROR_INVALID_INDEX",
  NO_COMMITMENTS = "DATA_COLUMN_SIDECAR_ERROR_NO_COMMITMENTS",
  MISMATCH_LENGTHS = "DATA_COLUMN_SIDECAR_ERROR_MISMATCH_LENGTHS",
  // following errors are adapted from the block errors
  FUTURE_SLOT = "DATA_COLUMN_SIDECAR_ERROR_FUTURE_SLOT",

  NOT_LATER_THAN_PARENT = "DATA_COLUMN_SIDECAR_ERROR_NOT_LATER_THAN_PARENT",
  WOULD_REVERT_FINALIZED_SLOT = "DATA_COLUMN_SIDECAR_ERROR_WOULD_REVERT_FINALIZED_SLOT",
  PARENT_UNKNOWN = "DATA_COLUMN_SIDECAR_ERROR_PARENT_UNKNOWN",
  INCLUSION_PROOF_INVALID = "BLOB_SIDECAR_ERROR_INCLUSION_PROOF_INVALID",
  KZG_PROOF_INVALID = "BLOB_SIDECAR_ERROR_KZG_PROOF_INVALID",
  PROPOSAL_SIGNATURE_INVALID = "BLOB_SIDECAR_ERROR_PROPOSAL_SIGNATURE_INVALID",
}

export type DataColumnSidecarErrorType =
  | {
      code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID;
    }
  | {
      code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT;
      parentSlot: number;
      slot: number;
    }
  | {
      code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT;
      blockSlot: number;
      finalizedSlot: number;
    }
  | {code: DataColumnSidecarErrorCode.INVALID_INDEX; columnIndex: number; gossipIndex: number}
  | {code: DataColumnSidecarErrorCode.NO_COMMITMENTS; columnIndex: number; gossipIndex: number}
  | {
      code: DataColumnSidecarErrorCode.MISMATCH_LENGTHS;
      columnLength: number;
      commitmentsLength: number;
      proofsLength: number;
    }
  | {
      code: DataColumnSidecarErrorCode.KZG_PROOF_INVALID;
      slot: Slot;
      blockRoot: RootHex;
      columnIndex: number;
    }
  | {code: DataColumnSidecarErrorCode.FUTURE_SLOT; blockSlot: Slot; currentSlot: Slot}
  | {code: DataColumnSidecarErrorCode.PARENT_UNKNOWN; parentRoot: RootHex}
  | {code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID; slot: Slot; columnIdx: number};

export class DataColumnSidecarGossipError extends GossipActionError<DataColumnSidecarErrorType> {}
