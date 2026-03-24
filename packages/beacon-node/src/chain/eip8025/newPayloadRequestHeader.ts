import {ContainerType, ListCompositeType} from "@chainsafe/ssz";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq, MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {ExecutionPayload, Root, Slot, deneb, electra, ssz} from "@lodestar/types";
import {kzgCommitmentToVersionedHash} from "../../util/blobs.js";

/**
 * EIP-8025: Compute the new_payload_request_root for a given block.
 *
 * The `newPayloadRequestRoot` is the tree hash root of `NewPayloadRequest`,
 * which contains the full execution payload (not the header), versioned hashes,
 * parent beacon block root, and execution requests.
 *
 * This matches Lighthouse's computation: `NewPayloadRequest.tree_hash_root()`.
 */
export function computeNewPayloadRequestRoot(
  config: ChainForkConfig,
  slot: Slot,
  executionPayload: ExecutionPayload,
  blobKzgCommitments: deneb.BlobKzgCommitments,
  parentBeaconBlockRoot: Root,
  executionRequests: electra.ExecutionRequests
): Uint8Array {
  const forkSeq = config.getForkSeq(slot);
  const versionedHashes = blobKzgCommitments.map(kzgCommitmentToVersionedHash);

  // Build the NewPayloadRequest container dynamically.
  // Uses the full ExecutionPayload (not the header) — matches Lighthouse's tree_hash_root.
  const payloadSszType = getExecutionPayloadSszType(forkSeq);
  const NewPayloadRequest = new ContainerType({
    executionPayload: payloadSszType,
    versionedHashes: new ListCompositeType(ssz.deneb.VersionedHash, MAX_BLOB_COMMITMENTS_PER_BLOCK),
    parentBeaconBlockRoot: ssz.Root,
    executionRequests: ssz.electra.ExecutionRequests,
  });

  return NewPayloadRequest.hashTreeRoot({
    executionPayload: executionPayload,
    versionedHashes,
    parentBeaconBlockRoot,
    executionRequests,
  });
}

function getExecutionPayloadSszType(forkSeq: ForkSeq): ContainerType<any> {
  // ExecutionPayload is the same from deneb through electra/fulu
  if (forkSeq >= ForkSeq.deneb) {
    return ssz.deneb.ExecutionPayload;
  }
  throw new Error(`EIP-8025 requires at least deneb fork, got fork sequence ${forkSeq}`);
}
