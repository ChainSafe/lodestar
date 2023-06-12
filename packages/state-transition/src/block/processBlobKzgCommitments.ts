import {BlockExternalData, ExecutionPayloadStatus} from "./externalData.js";

/**
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/beacon-chain.md#blob-kzg-commitments
 *
 * def process_blob_kzg_commitments(state: BeaconState, body: BeaconBlockBody):
 *   assert verify_kzg_commitments_against_transactions(
 *     body.execution_payload.transactions,
 *     body.blob_kzg_commitments
 *   )
 */
export function processBlobKzgCommitments(externalData: BlockExternalData): void {
  switch (externalData.executionPayloadStatus) {
    case ExecutionPayloadStatus.preMerge:
      throw Error("executionPayloadStatus preMerge");
    case ExecutionPayloadStatus.invalid:
      throw Error("Invalid execution payload");
    case ExecutionPayloadStatus.valid:
      break; // ok
  }
}
