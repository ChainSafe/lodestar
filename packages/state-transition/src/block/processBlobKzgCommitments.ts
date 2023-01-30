import {deneb} from "@lodestar/types";
import {verifyKzgCommitmentsAgainstTransactions} from "../util/index.js";

/**
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/beacon-chain.md#blob-kzg-commitments
 *
 * def process_blob_kzg_commitments(state: BeaconState, body: BeaconBlockBody):
 *   assert verify_kzg_commitments_against_transactions(
 *     body.execution_payload.transactions,
 *     body.blob_kzg_commitments
 *   )
 */
export function processBlobKzgCommitments(body: deneb.BeaconBlockBody): void {
  if (!verifyKzgCommitmentsAgainstTransactions(body.executionPayload.transactions, body.blobKzgCommitments)) {
    throw Error("Invalid KZG commitments against transactions");
  }
}
