import {IChainForkConfig} from "@lodestar/config";
import {eip4844} from "@lodestar/types";
import {verifyKzgCommitmentsAgainstTransactions} from "@lodestar/state-transition";
import {IBeaconChain} from "../interface.js";
import {BlobsSidecarError, BlobsSidecarErrorCode} from "../errors/blobsSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";

export async function validateGossipBlobsSidecar(
  config: IChainForkConfig,
  chain: IBeaconChain,
  signedBlock: eip4844.SignedBeaconBlock,
  blobsSidecar: eip4844.BlobsSidecar
): Promise<void> {
  const block = signedBlock.message;

  // Spec: https://github.com/ethereum/consensus-specs/blob/4cb6fd1c8c8f190d147d15b182c2510d0423ec61/specs/eip4844/p2p-interface.md#beacon_block_and_blobs_sidecar
  // [REJECT] The KZG commitments of the blobs are all correctly encoded compressed BLS G1 Points.
  // -- i.e. all(bls.KeyValidate(commitment) for commitment in block.body.blob_kzg_commitments)
  const {blobKzgCommitments} = block.body;
  for (let i = 0; i < blobKzgCommitments.length; i++) {
    if (!bls.keyValidate(blobKzgCommitments[i])) {
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
  TODO;

  // [REJECT] The KZG proof is a correctly encoded compressed BLS G1 Point
  // -- i.e. bls.KeyValidate(blobs_sidecar.kzg_aggregated_proof)
  if (!bls.KeyValidate(blobsSidecar.kzgAggregatedProof)) {
    throw new BlobsSidecarError(GossipAction.REJECT, {code: BlobsSidecarErrorCode.INVALID_KZG_PROOF});
  }
}

type Result<T> = {ok: true; result: T} | {ok: false; error: Error};

function rustOk(): Result<string>;

function Ok<T>(result: T): Result<T> {
  return {ok: true, result};
}

function okUser(): Result<number> {
  const res = rustOk();
  if (!res.ok) return res;
  const resStr = res.result;

  return Ok(parseInt(resStr));
}
