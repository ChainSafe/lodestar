import {
  DATA_COLUMN_SIDECAR_SUBNET_COUNT,
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENTS_SUBTREE_INDEX,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {ColumnIndex, Root, RootHex, Slot, SubnetID, deneb, fulu, ssz} from "@lodestar/types";
import {toHex, verifyMerkleBranch} from "@lodestar/utils";

import {byteArrayEquals} from "../../util/bytes.js";
import {ckzg} from "../../util/kzg.js";
import {DataColumnSidecarErrorCode, DataColumnSidecarGossipError} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";
import {computeStartSlotAtEpoch, getBlockHeaderProposerSignatureSet} from "@lodestar/state-transition";
import {RegenCaller} from "../regen/interface.js";
import {BlockInput} from "../blocks/utils/blockInput.js";
import {KZGCommitment} from "c-kzg";

// 1) [REJECT] The sidecar is valid as verified by verify_data_column_sidecar(sidecar).
// 2) [REJECT] The sidecar is for the correct subnet -- i.e. compute_subnet_for_data_column_sidecar(sidecar.index) == subnet_id.
// 3) [IGNORE] The sidecar is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance) -- i.e. validate that block_header.slot <= current_slot (a client MAY queue future sidecars for processing at the appropriate slot).
// 4) [IGNORE] The sidecar is from a slot greater than the latest finalized slot -- i.e. validate that block_header.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
// 5) [REJECT] The proposer signature of sidecar.signed_block_header, is valid with respect to the block_header.proposer_index pubkey.
// 6) [IGNORE] The sidecar's block's parent (defined by block_header.parent_root) has been seen (via gossip or non-gossip sources) (a client MAY queue sidecars for processing once the parent block is retrieved).
// 7) [REJECT] The sidecar's block's parent (defined by block_header.parent_root) passes validation.
// 8) [REJECT] The sidecar is from a higher slot than the sidecar's block's parent (defined by block_header.parent_root).

// 9) [REJECT] The current finalized_checkpoint is an ancestor of the sidecar's block -- i.e. get_checkpoint_block(store, block_header.parent_root, store.finalized_checkpoint.epoch) == store.finalized_checkpoint.root.
// 10) [REJECT] The sidecar's kzg_commitments field inclusion proof is valid as verified by verify_data_column_sidecar_inclusion_proof(sidecar).
// 11) [REJECT] The sidecar's column data is valid as verified by verify_data_column_sidecar_kzg_proofs(sidecar).
// 12) [IGNORE] The sidecar is the first sidecar for the tuple (block_header.slot, block_header.proposer_index, sidecar.index) with valid header signature, sidecar inclusion proof, and kzg proof.
// 13) [REJECT] The sidecar is proposed by the expected proposer_index for the block's slot in the context of the current shuffling (defined by block_header.parent_root/block_header.slot). If the proposer_index cannot immediately be verified against the expected shuffling, the sidecar MAY be queued for later processing while proposers for the block's branch are calculated -- in such a case do not REJECT, instead IGNORE this message.

// SPEC FUNCTION
// https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#data_column_sidecar_subnet_id
export async function validateGossipDataColumnSidecar(
  chain: IBeaconChain,
  blockInput: BlockInput,
  dataColumnSidecar: fulu.DataColumnSidecar,
  columnIndex: number
): Promise<void> {
  const dataColumnSlot = dataColumnSidecar.signedBlockHeader.message.slot;

  // 1) [REJECT] The sidecar is valid as verified by verify_data_column_sidecar
  verifyDataColumnSidecar(columnIndex, dataColumnSidecar);

  // 2) [REJECT] The sidecar is for the correct subnet -- i.e. compute_subnet_for_data_column_sidecar(sidecar.index) == subnet_id
  if (computeSubnetForDataColumnSidecar(dataColumnSidecar) !== columnIndex) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_INDEX,
      columnIndex: dataColumnSidecar.index,
      gossipIndex: columnIndex,
    });
  }

  // 3) [IGNORE] The sidecar is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  //             -- i.e. validate that sidecar.slot <= current_slot (a client MAY queue future blocks
  //             for processing at the appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < dataColumnSlot) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot: dataColumnSlot,
    });
  }

  // 4) [IGNORE] The sidecar is from a slot greater than the latest finalized slot -- i.e. validate that
  //             sidecar.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (dataColumnSlot <= finalizedSlot) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot: dataColumnSlot,
      finalizedSlot,
    });
  }

  // 6) [IGNORE] The sidecar's block's parent (defined by block_header.parent_root) has been seen (via gossip
  //          or non-gossip sources)
  const parentRoot = blockInput.getParentRootHex();
  const parentBlock = chain.forkChoice.getBlockHex(parentRoot);
  if (parentBlock === null) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
      parentRoot,
    });
  }

  // 8) [REJECT] The sidecar is from a higher slot than the sidecar's block's parent
  if (parentBlock.slot >= dataColumnSlot) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: dataColumnSlot,
    });
  }

  // 7) [REJECT] The sidecar's block's parent passes validation.
  const blockState = await chain.regen
    .getBlockSlotState(parentRoot, dataColumnSlot, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
        parentRoot,
      });
    });

  // 5) [REJECT] The proposer signature of sidecar.signed_block_header, is valid with respect to the block_header.proposer_index pubkey.
  const signatureSet = getBlockHeaderProposerSignatureSet(blockState, dataColumnSidecar.signedBlockHeader);
  // Don't batch so verification is not delayed
  // TODO: (@matthewkeil) Should this and the blob signature be done main thread like the block?  Talk with @twoeths
  if (!(await chain.bls.verifySignatureSets([signatureSet], {verifyOnMainThread: true}))) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
    });
  }

  // if (parentBlock === null) {
  //   // If fork choice does *not* consider the parent to be a descendant of the finalized block,
  //   // then there are two more cases:
  //   //
  //   // 1. We have the parent stored in our database. Because fork-choice has confirmed the
  //   //    parent is *not* in our post-finalization DAG, all other blocks must be either
  //   //    pre-finalization or conflicting with finalization.
  //   // 2. The parent is unknown to us, we probably want to download it since it might actually
  //   //    descend from the finalized root.
  //   // (Non-Lighthouse): Since we prune all blocks non-descendant from finalized checking the `db.block` database won't be useful to guard
  //   // against known bad fork blocks, so we throw PARENT_UNKNOWN for cases (1) and (2)
  //   throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
  //     code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
  //     parentRoot,
  //   });
  // }

  // [REJECT] The current finalized_checkpoint is an ancestor of the sidecar's block
  //          -- i.e. get_checkpoint_block(store, block_header.parent_root, store.finalized_checkpoint.epoch)
  //                  == store.finalized_checkpoint.root

  // 10) [REJECT] The sidecar's kzg_commitments field inclusion proof is valid as verified by
  //          verify_data_column_sidecar_inclusion_proof
  if (!verifyDataColumnSidecarInclusionProof(dataColumnSidecar)) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
      slot: dataColumnSidecar.signedBlockHeader.message.slot,
      columnIdx: dataColumnSidecar.index,
    });
  }

  // [REJECT] The sidecar's column data is valid as verified by verify_data_column_sidecar_kzg_proofs
  try {
    verifyDataColumnSidecarKzgProofs(
      dataColumnSidecar.kzgCommitments,
      Array.from({length: dataColumnSidecar.column.length}, () => dataColumnSidecar.index),
      dataColumnSidecar.column,
      dataColumnSidecar.kzgProofs
    );
  } catch {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.KZG_PROOF_INVALID,
      slot: dataColumnSlot,
      blockRoot: blockInput.rootHex,
      columnIndex: dataColumnSidecar.index,
    });
  }

  // [IGNORE] The sidecar is the first sidecar for the tuple (block_header.slot, block_header.proposer_index,
  //          sidecar.index) with valid header signature, sidecar inclusion proof, and kzg proof

  // [REJECT] The sidecar is proposed by the expected proposer_index for the block's slot in the context of the current
  //          shuffling (defined by block_header.parent_root/block_header.slot). If the proposer_index cannot
  //          immediately be verified against the expected shuffling, the sidecar MAY be queued for later processing
  //          while proposers for the block's branch are calculated -- in such a case do not REJECT, instead IGNORE
  //          this message.
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#verify_data_column_sidecar
 */
export function verifyDataColumnSidecar(columnIndex: number, dataColumnSidecar: fulu.DataColumnSidecar): void {
  if (dataColumnSidecar.index > NUMBER_OF_COLUMNS) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_INDEX,
      columnIndex: dataColumnSidecar.index,
      gossipIndex: columnIndex,
    });
  }

  if (dataColumnSidecar.kzgCommitments.length === 0) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.NO_COMMITMENTS,
      columnIndex: dataColumnSidecar.index,
      gossipIndex: columnIndex,
    });
  }

  if (
    dataColumnSidecar.column.length !== dataColumnSidecar.kzgCommitments.length ||
    dataColumnSidecar.column.length !== dataColumnSidecar.kzgProofs.length
  ) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.MISMATCH_LENGTHS,
      columnLength: dataColumnSidecar.column.length,
      commitmentsLength: dataColumnSidecar.kzgCommitments.length,
      proofsLength: dataColumnSidecar.kzgProofs.length,
    });
  }
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#verify_data_column_sidecar_kzg_proofs
 */
export function verifyDataColumnSidecarKzgProofs(
  commitments: Uint8Array[],
  cellIndices: number[],
  cells: Uint8Array[],
  proofs: Uint8Array[]
): void {
  let valid: boolean;
  try {
    valid = ckzg.verifyCellKzgProofBatch(commitments, cellIndices, cells, proofs);
  } catch (e) {
    (e as Error).message = `Error on verifyCellKzgProofBatch: ${(e as Error).message}`;
    throw e;
  }
  if (!valid) {
    throw Error("Invalid verifyCellKzgProofBatch");
  }
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#verify_data_column_sidecar_inclusion_proof
 */
export function verifyDataColumnSidecarInclusionProof(dataColumnSidecar: fulu.DataColumnSidecar): boolean {
  return verifyMerkleBranch(
    ssz.deneb.BlobKzgCommitments.hashTreeRoot(dataColumnSidecar.kzgCommitments),
    dataColumnSidecar.kzgCommitmentsInclusionProof,
    KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
    KZG_COMMITMENTS_SUBTREE_INDEX,
    dataColumnSidecar.signedBlockHeader.message.bodyRoot
  );
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#compute_subnet_for_data_column_sidecar
 */
export function computeSubnetForDataColumnSidecar(columnSidecar: fulu.DataColumnSidecar): SubnetID {
  return columnSidecar.index % DATA_COLUMN_SIDECAR_SUBNET_COUNT;
}
