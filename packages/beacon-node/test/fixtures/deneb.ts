import crypto from "node:crypto";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {capella, deneb} from "@lodestar/types";
import {MAX_BLOBS_PER_BLOCK} from "@lodestar/params";
import {generateCapellaBeaconBlocks, BlockGenerationOptionsCapella} from "./capella.js";

export function generateDenebExecutionPayload(payload: capella.ExecutionPayload): deneb.ExecutionPayload {
  return {
    ...payload,
    blobGasUsed: BigInt(0),
    excessBlobGas: BigInt(0),
  };
}

export function generateKzgCommitments(count: number): deneb.BlobKzgCommitments {
  return Array.from({length: count}, () => Uint8Array.from(crypto.randomBytes(48)));
}

export interface BlockGenerationOptionsDeneb extends BlockGenerationOptionsCapella {
  numKzgCommitments: number;
}

export function generateDenebBeaconBlocks(
  state: CachedBeaconStateAllForks,
  count: number,
  opts?: BlockGenerationOptionsDeneb
): capella.BeaconBlock[] {
  const blocks = generateCapellaBeaconBlocks(state, count, opts) as deneb.BeaconBlock[];
  for (const block of blocks) {
    block.body.executionPayload = generateDenebExecutionPayload(block.body.executionPayload);
    block.body.blobKzgCommitments = generateKzgCommitments(opts?.numKzgCommitments ?? MAX_BLOBS_PER_BLOCK);
  }
  return blocks;
}
