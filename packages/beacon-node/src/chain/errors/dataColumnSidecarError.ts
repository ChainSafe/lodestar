import {RootHex, Slot, SubnetID} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum DataColumnSidecarErrorCode {
  INVALID_INDEX = "DATA_COLUMN_SIDECAR_ERROR_INVALID_INDEX",
  NO_COMMITMENTS = "DATA_COLUMN_SIDECAR_ERROR_NO_COMMITMENTS",
  MISMATCHED_LENGTHS = "DATA_COLUMN_SIDECAR_ERROR_MISMATCHED_LENGTHS",
  INVALID_SUBNET = "DATA_COLUMN_SIDECAR_ERROR_INVALID_SUBNET",
  INVALID_KZG_PROOF = "DATA_COLUMN_SIDECAR_ERROR_INVALID_KZG_PROOF",

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
  | {code: DataColumnSidecarErrorCode.INVALID_INDEX; columnIdx: number}
  | {code: DataColumnSidecarErrorCode.NO_COMMITMENTS; columnIdx: number}
  | {
      code: DataColumnSidecarErrorCode.MISMATCHED_LENGTHS;
      columnLength: number;
      commitmentsLength: number;
      proofsLength: number;
    }
  | {code: DataColumnSidecarErrorCode.INVALID_SUBNET; columnIdx: number; gossipSubnet: SubnetID}
  | {code: DataColumnSidecarErrorCode.ALREADY_KNOWN; columnIdx: number; slot: Slot}
  | {code: DataColumnSidecarErrorCode.FUTURE_SLOT; blockSlot: Slot; currentSlot: Slot}
  | {code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT; blockSlot: Slot; finalizedSlot: Slot}
  | {code: DataColumnSidecarErrorCode.PARENT_UNKNOWN; parentRoot: RootHex}
  | {code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID}
  | {code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT; parentSlot: Slot; slot: Slot}
  | {code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID; slot: Slot; columnIdx: number}
  | {code: DataColumnSidecarErrorCode.INVALID_KZG_PROOF; slot: Slot; columnIdx: number}
  | {code: DataColumnSidecarErrorCode.INCORRECT_PROPOSER; actualProposerIndex: number; expectedProposerIndex: number};

export class DataColumnSidecarGossipError extends GossipActionError<DataColumnSidecarErrorType> {}
