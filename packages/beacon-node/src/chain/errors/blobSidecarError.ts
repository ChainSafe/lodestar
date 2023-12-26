import {Slot, RootHex, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum BlobSidecarErrorCode {
  INVALID_INDEX = "BLOB_SIDECAR_ERROR_INVALID_INDEX",
  /** !bls.KeyValidate(block.body.blob_kzg_commitments[i]) */
  INVALID_KZG = "BLOB_SIDECAR_ERROR_INVALID_KZG",
  /** !verify_kzg_commitments_against_transactions(block.body.execution_payload.transactions, block.body.blob_kzg_commitments) */
  INVALID_KZG_TXS = "BLOB_SIDECAR_ERROR_INVALID_KZG_TXS",
  /** sidecar.beacon_block_slot != block.slot */
  INCORRECT_SLOT = "BLOB_SIDECAR_ERROR_INCORRECT_SLOT",
  /** BLSFieldElement in valid range (x < BLS_MODULUS) */
  INVALID_BLOB = "BLOB_SIDECAR_ERROR_INVALID_BLOB",
  /** !bls.KeyValidate(blobs_sidecar.kzg_aggregated_proof) */
  INVALID_KZG_PROOF = "BLOBS_SIDECAR_ERROR_INVALID_KZG_PROOF",

  // following errors are adapted from the block errors
  FUTURE_SLOT = "BLOB_SIDECAR_ERROR_FUTURE_SLOT",
  WOULD_REVERT_FINALIZED_SLOT = "BLOB_SIDECAR_ERROR_WOULD_REVERT_FINALIZED_SLOT",
  ALREADY_KNOWN = "BLOB_SIDECAR_ERROR_ALREADY_KNOWN",
  PARENT_UNKNOWN = "BLOB_SIDECAR_ERROR_PARENT_UNKNOWN",
  NOT_LATER_THAN_PARENT = "BLOB_SIDECAR_ERROR_NOT_LATER_THAN_PARENT",
  PROPOSAL_SIGNATURE_INVALID = "BLOB_SIDECAR_ERROR_PROPOSAL_SIGNATURE_INVALID",
  INCLUSION_PROOF_INVALID = "BLOB_SIDECAR_ERROR_INCLUSION_PROOF_INVALID",
  INCORRECT_PROPOSER = "BLOB_SIDECAR_ERROR_INCORRECT_PROPOSER",
}

export type BlobSidecarErrorType =
  | {code: BlobSidecarErrorCode.INVALID_INDEX; blobIdx: number; gossipIndex: number}
  | {code: BlobSidecarErrorCode.INVALID_KZG; blobIdx: number}
  | {code: BlobSidecarErrorCode.INVALID_KZG_TXS}
  | {code: BlobSidecarErrorCode.INCORRECT_SLOT; blockSlot: Slot; blobSlot: Slot; blobIdx: number}
  | {code: BlobSidecarErrorCode.INVALID_BLOB; blobIdx: number}
  | {code: BlobSidecarErrorCode.INVALID_KZG_PROOF; blobIdx: number}
  | {code: BlobSidecarErrorCode.FUTURE_SLOT; blockSlot: Slot; currentSlot: Slot}
  | {code: BlobSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT; blockSlot: Slot; finalizedSlot: Slot}
  | {code: BlobSidecarErrorCode.ALREADY_KNOWN; root: RootHex}
  | {code: BlobSidecarErrorCode.PARENT_UNKNOWN; parentRoot: RootHex}
  | {code: BlobSidecarErrorCode.NOT_LATER_THAN_PARENT; parentSlot: Slot; slot: Slot}
  | {code: BlobSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID}
  | {code: BlobSidecarErrorCode.INCLUSION_PROOF_INVALID; slot: Slot; blobIdx: number}
  | {code: BlobSidecarErrorCode.INCORRECT_PROPOSER; proposerIndex: ValidatorIndex};

export class BlobSidecarGossipError extends GossipActionError<BlobSidecarErrorType> {}
