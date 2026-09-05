import {ChainConfig} from "@lodestar/config";
import {
  ForkName,
  KZG_COMMITMENT_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENT_SUBTREE_INDEX0,
  isForkPostElectra,
} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockHeaderProposerSignatureSetByHeaderSlot,
} from "@lodestar/state-transition";
import {BlobIndex, Root, Slot, SubnetID, deneb, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex, verifyMerkleBranch} from "@lodestar/utils";
import {kzg} from "../../util/kzg.js";
import {BlobSidecarErrorCode, BlobSidecarGossipError, BlobSidecarValidationError} from "../errors/blobSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/index.js";
import {isFinalizedCheckpointAncestor} from "./isFinalizedCheckpointAncestor.js";

export async function validateGossipBlobSidecar(
  fork: ForkName,
  chain: IBeaconChain,
  blobSidecar: deneb.BlobSidecar,
  subnet: SubnetID
): Promise<void> {
  const blobSlot = blobSidecar.signedBlockHeader.message.slot;
  const proposerIndex = blobSidecar.signedBlockHeader.message.proposerIndex;

  // [IGNORE] The sidecar is the first sidecar for the tuple
  // (block_header.slot, block_header.proposer_index, blob_sidecar.index)
  if (chain.seenBlockInputCache.isSeenBlobSidecar(blobSlot, proposerIndex, blobSidecar.index)) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.ALREADY_SEEN_TUPLE,
      root: toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message)),
      blobIdx: blobSidecar.index,
    });
  }

  // [REJECT] The sidecar's index is consistent with MAX_BLOBS_PER_BLOCK
  const maxBlobsPerBlock = chain.config.getMaxBlobsPerBlock(computeEpochAtSlot(blobSlot));
  if (blobSidecar.index >= maxBlobsPerBlock) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INDEX_TOO_LARGE,
      blobIdx: blobSidecar.index,
      maxBlobsPerBlock,
    });
  }

  // [REJECT] The sidecar is for the correct subnet
  if (computeSubnetForBlobSidecar(fork, chain.config, blobSidecar.index) !== subnet) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INVALID_INDEX,
      blobIdx: blobSidecar.index,
      subnet,
    });
  }

  // [IGNORE] The sidecar is not from a future slot
  // (MAY be queued for processing at the appropriate slot)
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blobSlot) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot: blobSlot,
    });
  }

  // [IGNORE] The sidecar is from a slot greater than the latest finalized slot
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (blobSlot <= finalizedSlot) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot: blobSlot,
      finalizedSlot,
    });
  }

  // Lodestar optimization (not in spec): early exit if the block is already in
  // fork-choice. Post-finalization the fork-choice lookup is authoritative.
  const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
  const blockHex = toRootHex(blockRoot);
  if (chain.forkChoice.getBlockHexDefaultStatus(blockHex) !== null) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {code: BlobSidecarErrorCode.ALREADY_KNOWN, root: blockHex});
  }

  const validatorCount = chain.getHeadState().validatorCount;
  if (proposerIndex >= validatorCount) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.PROPOSER_INDEX_OUT_OF_RANGE,
      proposerIndex,
      validatorCount,
    });
  }

  // [REJECT] The proposer signature of blob_sidecar.signed_block_header is valid
  const signature = blobSidecar.signedBlockHeader.signature;
  if (!chain.seenBlockInputCache.isVerifiedProposerSignature(blobSlot, blockHex, signature)) {
    const signatureSet = getBlockHeaderProposerSignatureSetByHeaderSlot(chain.config, blobSidecar.signedBlockHeader);
    // Don't batch so verification is not delayed
    if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
      throw new BlobSidecarGossipError(GossipAction.REJECT, {
        code: BlobSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
        blockRoot: blockHex,
        index: blobSidecar.index,
        slot: blobSlot,
      });
    }

    chain.seenBlockInputCache.markVerifiedProposerSignature(blobSlot, blockHex, signature);
  }

  // [IGNORE] The sidecar's block's parent has been seen
  // (MAY be queued for processing once the parent block is retrieved)
  const parentRoot = toRootHex(blobSidecar.signedBlockHeader.message.parentRoot);
  const parentBlock = chain.forkChoice.getBlockHexDefaultStatus(parentRoot);
  if (parentBlock === null) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.PARENT_UNKNOWN,
      parentRoot,
      blockRoot: blockHex,
      slot: blobSlot,
    });
  }

  // [REJECT] The sidecar is from a higher slot than the sidecar's block's parent
  if (parentBlock.slot >= blobSlot) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: blobSlot,
    });
  }

  // [REJECT] The current finalized_checkpoint is an ancestor of the sidecar's block
  if (!isFinalizedCheckpointAncestor(chain.forkChoice, parentRoot, finalizedCheckpoint)) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.FINALIZED_NOT_ANCESTOR,
      parentRoot,
      finalizedRoot: finalizedCheckpoint.rootHex,
    });
  }

  // [REJECT] The sidecar's inclusion proof is valid as verified by verify_blob_sidecar_inclusion_proof
  if (!validateBlobSidecarInclusionProof(blobSidecar)) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INCLUSION_PROOF_INVALID,
      slot: blobSidecar.signedBlockHeader.message.slot,
      blobIdx: blobSidecar.index,
    });
  }

  // [REJECT] The sidecar is proposed by the expected proposer_index
  // (if shuffling is not available, IGNORE instead and MAY be queued for later)
  const blockState = await chain.regen
    .getBlockSlotState(parentBlock, blobSlot, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new BlobSidecarGossipError(GossipAction.IGNORE, {
        code: BlobSidecarErrorCode.PARENT_UNKNOWN,
        parentRoot,
        blockRoot: blockHex,
        slot: blobSlot,
      });
    });
  if (blockState.getBeaconProposer(blobSlot) !== proposerIndex) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INCORRECT_PROPOSER,
      proposerIndex,
    });
  }

  // [REJECT] The sidecar's blob is valid as verified by verify_blob_kzg_proof
  try {
    await validateBlobsAndBlobProofs([blobSidecar.kzgCommitment], [blobSidecar.blob], [blobSidecar.kzgProof]);
  } catch (_e) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INVALID_KZG_PROOF,
      blobIdx: blobSidecar.index,
    });
  }

  // Another sidecar for this tuple may have completed validation during the awaits.
  if (chain.seenBlockInputCache.isSeenBlobSidecar(blobSlot, proposerIndex, blobSidecar.index)) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.ALREADY_SEEN_TUPLE,
      root: blockHex,
      blobIdx: blobSidecar.index,
    });
  }

  chain.seenBlockInputCache.markSeenBlobSidecar(blobSlot, proposerIndex, blobSidecar.index);
}

/**
 * Validate some blob sidecars in a block
 *
 * Requires the block to be known to the node
 *
 * NOTE: chain is optional to skip signature verification. Helpful for testing purposes and so that can control whether
 * signature gets checked depending on the reqresp method that is being checked
 */
export async function validateBlockBlobSidecars(
  chain: IBeaconChain | null,
  blockSlot: Slot,
  blockRoot: Root,
  blockBlobCount: number,
  blobSidecars: deneb.BlobSidecars
): Promise<void> {
  if (blobSidecars.length === 0) {
    return;
  }

  if (blockBlobCount === 0) {
    throw new BlobSidecarValidationError({
      code: BlobSidecarErrorCode.INCORRECT_SIDECAR_COUNT,
      slot: blockSlot,
      expected: blockBlobCount,
      actual: blobSidecars.length,
    });
  }

  // Hash the first sidecar block header and compare the rest via (cheaper) equality
  const firstSidecarSignedBlockHeader = blobSidecars[0].signedBlockHeader;
  const firstSidecarBlockHeader = firstSidecarSignedBlockHeader.message;
  const firstBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(firstSidecarBlockHeader);
  if (!byteArrayEquals(blockRoot, firstBlockRoot)) {
    throw new BlobSidecarValidationError(
      {
        code: BlobSidecarErrorCode.INCORRECT_BLOCK,
        slot: blockSlot,
        blobIdx: 0,
        expected: toRootHex(blockRoot),
        actual: toRootHex(firstBlockRoot),
      },
      "BlobSidecar doesn't match corresponding block"
    );
  }

  if (chain !== null) {
    const blockRootHex = toRootHex(blockRoot);
    const signature = firstSidecarSignedBlockHeader.signature;
    if (!chain.seenBlockInputCache.isVerifiedProposerSignature(blockSlot, blockRootHex, signature)) {
      const signatureSet = getBlockHeaderProposerSignatureSetByHeaderSlot(chain.config, firstSidecarSignedBlockHeader);

      if (
        !(await chain.bls.verifySignatureSets([signatureSet], {
          verifyOnMainThread: true,
        }))
      ) {
        throw new BlobSidecarValidationError({
          code: BlobSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
          blockRoot: blockRootHex,
          slot: blockSlot,
          index: blobSidecars[0].index,
        });
      }

      chain.seenBlockInputCache.markVerifiedProposerSignature(blockSlot, blockRootHex, signature);
    }
  }

  const commitments = [];
  const blobs = [];
  const proofs = [];
  for (let i = 0; i < blobSidecars.length; i++) {
    const blobSidecar = blobSidecars[i];
    const blobIndex = blobSidecar.index;

    if (
      i !== 0 &&
      !ssz.phase0.SignedBeaconBlockHeader.equals(blobSidecar.signedBlockHeader, firstSidecarSignedBlockHeader)
    ) {
      throw new BlobSidecarValidationError(
        {
          code: BlobSidecarErrorCode.INCORRECT_BLOCK,
          slot: blockSlot,
          blobIdx: blobIndex,
          expected: toRootHex(blockRoot),
          actual: "unknown - compared via equality",
        },
        "BlobSidecar doesn't match corresponding block"
      );
    }

    if (!validateBlobSidecarInclusionProof(blobSidecar)) {
      throw new BlobSidecarValidationError(
        {
          code: BlobSidecarErrorCode.INCLUSION_PROOF_INVALID,
          slot: blockSlot,
          blobIdx: blobIndex,
        },
        "BlobSidecar inclusion proof invalid"
      );
    }

    commitments.push(blobSidecar.kzgCommitment);
    blobs.push(blobSidecar.blob);
    proofs.push(blobSidecar.kzgProof);
  }

  // Final batch KZG proof verification
  let reason: string | undefined = undefined;
  try {
    if (!(await kzg.asyncVerifyBlobKzgProofBatch(blobs, commitments, proofs))) {
      reason = "Invalid verifyBlobKzgProofBatch";
    }
  } catch (e) {
    reason = (e as Error).message;
  }
  if (reason !== undefined) {
    throw new BlobSidecarValidationError(
      {
        code: BlobSidecarErrorCode.INVALID_KZG_PROOF_BATCH,
        slot: blockSlot,
        reason,
      },
      "BlobSidecar has invalid KZG proof batch"
    );
  }
}

export async function validateBlobsAndBlobProofs(
  expectedKzgCommitments: deneb.BlobKzgCommitments,
  blobs: deneb.Blobs,
  proofs: deneb.KZGProofs
): Promise<void> {
  // assert verify_aggregate_kzg_proof(blobs, expected_kzg_commitments, kzg_aggregated_proof)
  let isProofValid: boolean;
  try {
    isProofValid = await kzg.asyncVerifyBlobKzgProofBatch(blobs, expectedKzgCommitments, proofs);
  } catch (e) {
    (e as Error).message = `Error on verifyBlobKzgProofBatch: ${(e as Error).message}`;
    throw e;
  }
  if (!isProofValid) {
    throw Error("Invalid verifyBlobKzgProofBatch");
  }
}

export function validateBlobSidecarInclusionProof(blobSidecar: deneb.BlobSidecar): boolean {
  return verifyMerkleBranch(
    ssz.deneb.KZGCommitment.hashTreeRoot(blobSidecar.kzgCommitment),
    blobSidecar.kzgCommitmentInclusionProof,
    KZG_COMMITMENT_INCLUSION_PROOF_DEPTH,
    KZG_COMMITMENT_SUBTREE_INDEX0 + blobSidecar.index,
    blobSidecar.signedBlockHeader.message.bodyRoot
  );
}

function computeSubnetForBlobSidecar(fork: ForkName, config: ChainConfig, blobIndex: BlobIndex): SubnetID {
  return (
    blobIndex % (isForkPostElectra(fork) ? config.BLOB_SIDECAR_SUBNET_COUNT_ELECTRA : config.BLOB_SIDECAR_SUBNET_COUNT)
  );
}
