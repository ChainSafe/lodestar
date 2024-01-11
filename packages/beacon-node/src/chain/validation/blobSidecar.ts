import {deneb, Root, Slot, ssz} from "@lodestar/types";
import {toHex, verifyMerkleBranch} from "@lodestar/utils";
import {computeStartSlotAtEpoch, getBlockHeaderProposerSignatureSet} from "@lodestar/state-transition";
import {KZG_COMMITMENT_INCLUSION_PROOF_DEPTH, KZG_COMMITMENT_SUBTREE_INDEX0} from "@lodestar/params";

import {BlobSidecarGossipError, BlobSidecarErrorCode} from "../errors/blobSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {ckzg} from "../../util/kzg.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/index.js";

export async function validateGossipBlobSidecar(
  chain: IBeaconChain,
  blobSidecar: deneb.BlobSidecar,
  gossipIndex: number
): Promise<void> {
  const blobSlot = blobSidecar.signedBlockHeader.message.slot;

  // [REJECT] The sidecar is for the correct topic -- i.e. sidecar.index matches the topic {index}.
  if (blobSidecar.index !== gossipIndex) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INVALID_INDEX,
      blobIdx: blobSidecar.index,
      gossipIndex,
    });
  }

  // [IGNORE] The sidecar is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance) --
  // i.e. validate that sidecar.slot <= current_slot (a client MAY queue future blocks for processing at
  // the appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blobSlot) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot: blobSlot,
    });
  }

  // [IGNORE] The sidecar is from a slot greater than the latest finalized slot -- i.e. validate that
  // sidecar.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (blobSlot <= finalizedSlot) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot: blobSlot,
      finalizedSlot,
    });
  }

  // Check if the block is already known. We know it is post-finalization, so it is sufficient to check the fork choice.
  //
  // In normal operation this isn't necessary, however it is useful immediately after a
  // reboot if the `observed_block_producers` cache is empty. In that case, without this
  // check, we will load the parent and state from disk only to find out later that we
  // already know this block.
  const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobSidecar.signedBlockHeader.message);
  const blockHex = toHex(blockRoot);
  if (chain.forkChoice.getBlockHex(blockHex) !== null) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {code: BlobSidecarErrorCode.ALREADY_KNOWN, root: blockHex});
  }

  // TODO: freetheblobs - check for badblock
  // TODO: freetheblobs - check that its first blob with valid signature

  // _[IGNORE]_ The blob's block's parent (defined by `sidecar.block_parent_root`) has been seen (via both
  // gossip and non-gossip sources) (a client MAY queue blocks for processing once the parent block is
  // retrieved).
  const parentRoot = toHex(blobSidecar.signedBlockHeader.message.parentRoot);
  const parentBlock = chain.forkChoice.getBlockHex(parentRoot);
  if (parentBlock === null) {
    // If fork choice does *not* consider the parent to be a descendant of the finalized block,
    // then there are two more cases:
    //
    // 1. We have the parent stored in our database. Because fork-choice has confirmed the
    //    parent is *not* in our post-finalization DAG, all other blocks must be either
    //    pre-finalization or conflicting with finalization.
    // 2. The parent is unknown to us, we probably want to download it since it might actually
    //    descend from the finalized root.
    // (Non-Lighthouse): Since we prune all blocks non-descendant from finalized checking the `db.block` database won't be useful to guard
    // against known bad fork blocks, so we throw PARENT_UNKNOWN for cases (1) and (2)
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {code: BlobSidecarErrorCode.PARENT_UNKNOWN, parentRoot});
  }

  // [REJECT] The blob is from a higher slot than its parent.
  if (parentBlock.slot >= blobSlot) {
    throw new BlobSidecarGossipError(GossipAction.IGNORE, {
      code: BlobSidecarErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: blobSlot,
    });
  }

  // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.
  // As a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).
  // this is something we should change this in the future to make the code airtight to the spec.
  // [IGNORE] The block's parent (defined by block.parent_root) has been seen (via both gossip and non-gossip sources) (a client MAY queue blocks for processing once the parent block is retrieved).
  // [REJECT] The block's parent (defined by block.parent_root) passes validation.
  const blockState = await chain.regen
    .getBlockSlotState(parentRoot, blobSlot, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new BlobSidecarGossipError(GossipAction.IGNORE, {code: BlobSidecarErrorCode.PARENT_UNKNOWN, parentRoot});
    });

  // [REJECT] The proposer signature, signed_beacon_block.signature, is valid with respect to the proposer_index pubkey.
  const signatureSet = getBlockHeaderProposerSignatureSet(blockState, blobSidecar.signedBlockHeader);
  // Don't batch so verification is not delayed
  if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
    });
  }

  // verify if the blob inclusion proof is correct
  if (!validateInclusionProof(blobSidecar)) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INCLUSION_PROOF_INVALID,
      slot: blobSidecar.signedBlockHeader.message.slot,
      blobIdx: blobSidecar.index,
    });
  }

  //  _[IGNORE]_ The sidecar is the only sidecar with valid signature received for the tuple
  // `(sidecar.block_root, sidecar.index)`
  //
  // This is already taken care of by the way we group the blobs in getFullBlockInput helper
  // but may be an error can be thrown there for this

  // _[REJECT]_ The sidecar is proposed by the expected `proposer_index` for the block's slot in the
  // context of the current shuffling (defined by `block_parent_root`/`slot`)
  // If the `proposer_index` cannot immediately be verified against the expected shuffling, the sidecar
  // MAY be queued for later processing while proposers for the block's branch are calculated -- in such
  // a case _do not_ `REJECT`, instead `IGNORE` this message.
  const proposerIndex = blobSidecar.signedBlockHeader.message.proposerIndex;
  if (blockState.epochCtx.getBeaconProposer(blobSlot) !== proposerIndex) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INCORRECT_PROPOSER,
      proposerIndex,
    });
  }

  // blob, proof and commitment as a valid BLS G1 point gets verified in batch validation
  try {
    validateBlobsAndProofs([blobSidecar.kzgCommitment], [blobSidecar.blob], [blobSidecar.kzgProof]);
  } catch (_e) {
    throw new BlobSidecarGossipError(GossipAction.REJECT, {
      code: BlobSidecarErrorCode.INVALID_KZG_PROOF,
      blobIdx: blobSidecar.index,
    });
  }
}

// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/beacon-chain.md#validate_blobs_sidecar
export function validateBlobSidecars(
  blockSlot: Slot,
  blockRoot: Root,
  expectedKzgCommitments: deneb.BlobKzgCommitments,
  blobSidecars: deneb.BlobSidecars,
  opts: {skipProofsCheck: boolean} = {skipProofsCheck: false}
): void {
  // assert len(expected_kzg_commitments) == len(blobs)
  if (expectedKzgCommitments.length !== blobSidecars.length) {
    throw new Error(
      `blobSidecars length to commitments length mismatch. Blob length: ${blobSidecars.length}, Expected commitments length ${expectedKzgCommitments.length}`
    );
  }

  // No need to verify the aggregate proof of zero blobs
  if (blobSidecars.length > 0) {
    // Verify the blob slot and root matches
    const blobs = [];
    const proofs = [];
    for (let index = 0; index < blobSidecars.length; index++) {
      const blobSidecar = blobSidecars[index];
      const blobBlockHeader = blobSidecar.signedBlockHeader.message;
      const blobBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blobBlockHeader);
      if (
        blobBlockHeader.slot !== blockSlot ||
        !byteArrayEquals(blobBlockRoot, blockRoot) ||
        blobSidecar.index !== index ||
        !byteArrayEquals(expectedKzgCommitments[index], blobSidecar.kzgCommitment)
      ) {
        throw new Error(
          `Invalid blob with slot=${blobBlockHeader.slot} blobBlockRoot=${toHex(blobBlockRoot)} index=${
            blobSidecar.index
          } for the block blockRoot=${toHex(blockRoot)} slot=${blockSlot} index=${index}`
        );
      }
      blobs.push(blobSidecar.blob);
      proofs.push(blobSidecar.kzgProof);
    }

    if (!opts.skipProofsCheck) {
      validateBlobsAndProofs(expectedKzgCommitments, blobs, proofs);
    }
  }
}

function validateBlobsAndProofs(
  expectedKzgCommitments: deneb.BlobKzgCommitments,
  blobs: deneb.Blobs,
  proofs: deneb.KZGProofs
): void {
  // assert verify_aggregate_kzg_proof(blobs, expected_kzg_commitments, kzg_aggregated_proof)
  let isProofValid: boolean;
  try {
    isProofValid = ckzg.verifyBlobKzgProofBatch(blobs, expectedKzgCommitments, proofs);
  } catch (e) {
    (e as Error).message = `Error on verifyBlobKzgProofBatch: ${(e as Error).message}`;
    throw e;
  }
  if (!isProofValid) {
    throw Error("Invalid verifyBlobKzgProofBatch");
  }
}

function validateInclusionProof(blobSidecar: deneb.BlobSidecar): boolean {
  return verifyMerkleBranch(
    ssz.deneb.KZGCommitment.hashTreeRoot(blobSidecar.kzgCommitment),
    blobSidecar.kzgCommitmentInclusionProof,
    KZG_COMMITMENT_INCLUSION_PROOF_DEPTH,
    KZG_COMMITMENT_SUBTREE_INDEX0 + blobSidecar.index,
    blobSidecar.signedBlockHeader.message.bodyRoot
  );
}
