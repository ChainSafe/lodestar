import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {eip4844} from "@lodestar/types";
import {bytesToBigInt} from "@lodestar/utils";
import {FIELD_ELEMENTS_PER_BLOB} from "@lodestar/params";
import {verifyKzgCommitmentsAgainstTransactions} from "@lodestar/state-transition";
import {BlobsSidecarError, BlobsSidecarErrorCode} from "../errors/blobsSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";

const BLS_MODULUS = BigInt("52435875175126190479447740508185965837690552500527637822603658699938581184513");

export async function validateGossipBlobsSidecar(
  signedBlock: eip4844.SignedBeaconBlock,
  blobsSidecar: eip4844.BlobsSidecar
): Promise<void> {
  const block = signedBlock.message;

  // Spec: https://github.com/ethereum/consensus-specs/blob/4cb6fd1c8c8f190d147d15b182c2510d0423ec61/specs/eip4844/p2p-interface.md#beacon_block_and_blobs_sidecar
  // [REJECT] The KZG commitments of the blobs are all correctly encoded compressed BLS G1 Points.
  // -- i.e. all(bls.KeyValidate(commitment) for commitment in block.body.blob_kzg_commitments)
  const {blobKzgCommitments} = block.body;
  for (let i = 0; i < blobKzgCommitments.length; i++) {
    if (!blsKeyValidate(blobKzgCommitments[i])) {
      throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG, kzgIdx: i});
    }
  }

  // [REJECT] The KZG commitments correspond to the versioned hashes in the transactions list.
  // -- i.e. verify_kzg_commitments_against_transactions(block.body.execution_payload.transactions, block.body.blob_kzg_commitments)
  if (
    !verifyKzgCommitmentsAgainstTransactions(block.body.executionPayload.transactions, block.body.blobKzgCommitments)
  ) {
    throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG_TXS});
  }

  // [IGNORE] the sidecar.beacon_block_slot is for the current slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  // -- i.e. sidecar.beacon_block_slot == block.slot.
  if (blobsSidecar.beaconBlockSlot !== block.slot) {
    throw new BlobsSidecarError(GossipAction.IGNORE, {
      code: BlobsSidecarErrorCode.INCORRECT_SLOT,
      blobSlot: blobsSidecar.beaconBlockSlot,
      blockSlot: block.slot,
    });
  }

  // [REJECT] the sidecar.blobs are all well formatted, i.e. the BLSFieldElement in valid range (x < BLS_MODULUS).
  for (let i = 0; blobsSidecar.blobs.length; i++) {
    if (!blobIsValidRange(blobsSidecar.blobs[i])) {
      throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_BLOB, blobIdx: i});
    }
  }

  // [REJECT] The KZG proof is a correctly encoded compressed BLS G1 Point
  // -- i.e. blsKeyValidate(blobs_sidecar.kzg_aggregated_proof)
  if (!blsKeyValidate(blobsSidecar.kzgAggregatedProof)) {
    throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG_PROOF});
  }
}

/**
 * From https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-bls-signature-04#section-2.5
 * KeyValidate = valid, non-identity point that is in the correct subgroup
 */
function blsKeyValidate(g1Point: Uint8Array): boolean {
  try {
    bls.PublicKey.fromBytes(g1Point, CoordType.jacobian, true);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * ```
 * Blob = new ByteVectorType(BYTES_PER_FIELD_ELEMENT * FIELD_ELEMENTS_PER_BLOB);
 * ```
 * Check that each FIELD_ELEMENT as a uint256 < BLS_MODULUS
 */
function blobIsValidRange(blob: eip4844.Blob): boolean {
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB; i++) {
    const fieldElement = blob.subarray(i, i * 32);
    const fieldElementBN = bytesToBigInt(fieldElement, "be");
    if (fieldElementBN >= BLS_MODULUS) {
      return false;
    }
  }

  return true;
}
