import {
  DATA_COLUMN_SIDECAR_SUBNET_COUNT,
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENTS_SUBTREE_INDEX,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {Root, Slot, SubnetID, deneb, fulu, ssz} from "@lodestar/types";
import {toRootHex, verifyMerkleBranch} from "@lodestar/utils";

import {computeStartSlotAtEpoch, getBlockHeaderProposerSignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {kzg} from "../../util/kzg.js";
import {DataColumnSidecarErrorCode, DataColumnSidecarGossipError} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/interface.js";

// SPEC FUNCTION
// https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#data_column_sidecar_subnet_id
export async function validateGossipDataColumnSidecar(
  chain: IBeaconChain,
  dataColumnSidecar: fulu.DataColumnSidecar,
  gossipSubnet: SubnetID,
  metrics: Metrics | null
): Promise<void> {
  const blockHeader = dataColumnSidecar.signedBlockHeader.message;

  // 1) [REJECT] The sidecar is valid as verified by verify_data_column_sidecar
  verifyDataColumnSidecar(dataColumnSidecar);

  // 2) [REJECT] The sidecar is for the correct subnet -- i.e. compute_subnet_for_data_column_sidecar(sidecar.index) == subnet_id
  if (computeSubnetForDataColumnSidecar(dataColumnSidecar) !== gossipSubnet) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_SUBNET,
      columnIdx: dataColumnSidecar.index,
      gossipSubnet: gossipSubnet,
    });
  }

  // 3) [IGNORE] The sidecar is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  //             -- i.e. validate that sidecar.slot <= current_slot (a client MAY queue future blocks
  //             for processing at the appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < blockHeader.slot) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot: blockHeader.slot,
    });
  }

  // 4) [IGNORE] The sidecar is from a slot greater than the latest finalized slot -- i.e. validate that
  //             sidecar.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (blockHeader.slot <= finalizedSlot) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT,
      blockSlot: blockHeader.slot,
      finalizedSlot,
    });
  }

  // 6) [IGNORE] The sidecar's block's parent (defined by block_header.parent_root) has been seen (via gossip
  //             or non-gossip sources)
  const parentRoot = toRootHex(blockHeader.parentRoot);
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
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
      parentRoot,
    });
  }

  // 8) [REJECT] The sidecar is from a higher slot than the sidecar's block's parent
  if (parentBlock.slot >= blockHeader.slot) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT,
      parentSlot: parentBlock.slot,
      slot: blockHeader.slot,
    });
  }

  // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.
  // As a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).
  // this is something we should change this in the future to make the code airtight to the spec.
  // 7) [REJECT] The sidecar's block's parent passes validation.
  const blockState = await chain.regen
    .getBlockSlotState(parentRoot, blockHeader.slot, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
        parentRoot,
      });
    });

  // 13) [REJECT] The sidecar is proposed by the expected proposer_index for the block's slot in the context of the current
  //              shuffling (defined by block_header.parent_root/block_header.slot). If the proposer_index cannot
  //              immediately be verified against the expected shuffling, the sidecar MAY be queued for later processing
  //              while proposers for the block's branch are calculated -- in such a case do not REJECT, instead IGNORE
  //              this message.
  const proposerIndex = blockHeader.proposerIndex;
  const expectedProposerIndex = blockState.epochCtx.getBeaconProposer(blockHeader.slot);

  if (proposerIndex !== expectedProposerIndex) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INCORRECT_PROPOSER,
      actualProposerIndex: proposerIndex,
      expectedProposerIndex,
    });
  }

  // 5) [REJECT] The proposer signature of sidecar.signed_block_header, is valid with respect to the block_header.proposer_index pubkey.
  const signatureSet = getBlockHeaderProposerSignatureSet(blockState, dataColumnSidecar.signedBlockHeader);
  // Don't batch so verification is not delayed
  if (
    !(await chain.bls.verifySignatureSets([signatureSet], {
      verifyOnMainThread: blockHeader.slot > chain.forkChoice.getHead().slot,
    }))
  ) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
    });
  }

  // 9) [REJECT] The current finalized_checkpoint is an ancestor of the sidecar's block
  //             -- i.e. get_checkpoint_block(store, block_header.parent_root, store.finalized_checkpoint.epoch)
  //                     == store.finalized_checkpoint.root
  // Handled by 7)

  // 10) [REJECT] The sidecar's kzg_commitments field inclusion proof is valid as verified by
  //              verify_data_column_sidecar_inclusion_proof
  //              TODO: Can cache result on (commitments, proof, header) in the future
  const timer = metrics?.peerDas.dataColumnSidecarInclusionProofVerificationTime.startTimer();
  const valid = verifyDataColumnSidecarInclusionProof(dataColumnSidecar);
  timer?.();

  if (!valid) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
      slot: dataColumnSidecar.signedBlockHeader.message.slot,
      columnIdx: dataColumnSidecar.index,
    });
  }

  // 11) [REJECT] The sidecar's column data is valid as verified by verify_data_column_sidecar_kzg_proofs
  try {
    await verifyDataColumnSidecarKzgProofs(
      dataColumnSidecar.kzgCommitments,
      Array.from({length: dataColumnSidecar.column.length}, () => dataColumnSidecar.index),
      dataColumnSidecar.column,
      dataColumnSidecar.kzgProofs
    );
  } catch {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_KZG_PROOF,
      slot: blockHeader.slot,
      columnIdx: dataColumnSidecar.index,
    });
  }

  // 12) [IGNORE] The sidecar is the first sidecar for the tuple (block_header.slot, block_header.proposer_index,
  //              sidecar.index) with valid header signature, sidecar inclusion proof, and kzg proof
  //              -- Handled in seenGossipBlockInput
}

export async function validateDataColumnsSidecars(
  blockSlot: Slot,
  blockRoot: Root,
  blockKzgCommitments: deneb.BlobKzgCommitments,
  dataColumnSidecars: fulu.DataColumnSidecars,
  metrics: Metrics | null,
  opts: {skipProofsCheck: boolean} = {skipProofsCheck: false}
): Promise<void> {
  const commitmentBytes: Uint8Array[] = [];
  const cellIndices: number[] = [];
  const cells: Uint8Array[] = [];
  const proofBytes: Uint8Array[] = [];

  for (let sidecarsIndex = 0; sidecarsIndex < dataColumnSidecars.length; sidecarsIndex++) {
    const columnSidecar = dataColumnSidecars[sidecarsIndex];
    const {index: columnIndex, column, kzgCommitments, kzgProofs} = columnSidecar;
    const columnBlockHeader = columnSidecar.signedBlockHeader.message;
    const columnBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(columnBlockHeader);
    if (
      columnBlockHeader.slot !== blockSlot ||
      !byteArrayEquals(columnBlockRoot, blockRoot) ||
      kzgCommitments.length === 0 ||
      blockKzgCommitments.length === 0 ||
      blockKzgCommitments.length !== kzgCommitments.length ||
      blockKzgCommitments
        .map((commitment, i) => byteArrayEquals(commitment, kzgCommitments[i]))
        .filter((result) => result === false).length
    ) {
      throw new Error(
        `Invalid data column sidecar slot=${columnBlockHeader.slot} columnBlockRoot=${toRootHex(columnBlockRoot)} columnIndex=${columnIndex} for the block blockRoot=${toRootHex(blockRoot)} slot=${blockSlot} sidecarsIndex=${sidecarsIndex}`
      );
    }

    if (columnIndex >= NUMBER_OF_COLUMNS) {
      throw new Error(
        `Invalid data sidecar columnIndex=${columnIndex} in slot=${blockSlot} blockRoot=${toRootHex(blockRoot)} sidecarsIndex=${sidecarsIndex}`
      );
    }

    if (column.length !== kzgCommitments.length || column.length !== kzgProofs.length) {
      throw new Error(
        `Invalid data sidecar array lengths for columnIndex=${columnIndex} in slot=${blockSlot} blockRoot=${toRootHex(blockRoot)}`
      );
    }

    commitmentBytes.push(...kzgCommitments);
    cellIndices.push(...Array.from({length: column.length}, () => columnIndex));
    cells.push(...column);
    proofBytes.push(...kzgProofs);
  }

  if (opts.skipProofsCheck) {
    return;
  }

  let valid: boolean;
  try {
    const timer = metrics?.peerDas.kzgVerificationDataColumnBatchTime.startTimer();
    valid = await kzg.asyncVerifyCellKzgProofBatch(commitmentBytes, cellIndices, cells, proofBytes);
    timer?.();
  } catch (err) {
    (err as Error).message = `Error in verifyCellKzgProofBatch for slot=${blockSlot} blockRoot=${toRootHex(blockRoot)}`;
    throw err;
  }

  if (!valid) {
    throw new Error(`Invalid data column sidecars in slot=${blockSlot} blockRoot=${toRootHex(blockRoot)}`);
  }
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#verify_data_column_sidecar
 */
export function verifyDataColumnSidecar(dataColumnSidecar: fulu.DataColumnSidecar): void {
  if (dataColumnSidecar.index >= NUMBER_OF_COLUMNS) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_INDEX,
      columnIdx: dataColumnSidecar.index,
    });
  }

  if (dataColumnSidecar.kzgCommitments.length === 0) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.NO_COMMITMENTS,
      columnIdx: dataColumnSidecar.index,
    });
  }

  if (
    dataColumnSidecar.column.length !== dataColumnSidecar.kzgCommitments.length ||
    dataColumnSidecar.column.length !== dataColumnSidecar.kzgProofs.length
  ) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.MISMATCHED_LENGTHS,
      columnLength: dataColumnSidecar.column.length,
      commitmentsLength: dataColumnSidecar.kzgCommitments.length,
      proofsLength: dataColumnSidecar.kzgProofs.length,
    });
  }
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#verify_data_column_sidecar_kzg_proofs
 */
export async function verifyDataColumnSidecarKzgProofs(
  commitments: Uint8Array[],
  cellIndices: number[],
  cells: Uint8Array[],
  proofs: Uint8Array[]
): Promise<void> {
  let valid: boolean;
  try {
    valid = await kzg.verifyCellKzgProofBatch(commitments, cellIndices, cells, proofs);
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
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#verify_data_column_sidecar_inclusion_proof
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
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#compute_subnet_for_data_column_sidecar
 */
export function computeSubnetForDataColumnSidecar(columnSidecar: fulu.DataColumnSidecar): SubnetID {
  return columnSidecar.index % DATA_COLUMN_SIDECAR_SUBNET_COUNT;
}
