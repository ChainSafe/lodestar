import {ChainConfig, ChainForkConfig} from "@lodestar/config";
import {
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENTS_SUBTREE_INDEX,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {
  computeEpochAtSlot,
  computeStartSlotAtEpoch,
  getBlockHeaderProposerSignatureSetByHeaderSlot,
  getBlockHeaderProposerSignatureSetByParentStateSlot,
} from "@lodestar/state-transition";
import {Root, Slot, SubnetID, fulu, ssz} from "@lodestar/types";
import {toRootHex, verifyMerkleBranch} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {kzg} from "../../util/kzg.js";
import {
  DataColumnSidecarErrorCode,
  DataColumnSidecarGossipError,
  DataColumnSidecarValidationError,
} from "../errors/dataColumnSidecarError.js";
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
  const blockRootHex = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader));

  // 1) [REJECT] The sidecar is valid as verified by verify_data_column_sidecar
  verifyDataColumnSidecar(chain.config, dataColumnSidecar);

  // 2) [REJECT] The sidecar is for the correct subnet -- i.e. compute_subnet_for_data_column_sidecar(sidecar.index) == subnet_id
  if (computeSubnetForDataColumnSidecar(chain.config, dataColumnSidecar) !== gossipSubnet) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_SUBNET,
      columnIndex: dataColumnSidecar.index,
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
      slot: blockHeader.slot,
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
    .getBlockSlotState(parentRoot, blockHeader.slot, {dontTransferCache: true}, RegenCaller.validateGossipDataColumn)
    .catch(() => {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
        parentRoot,
        slot: blockHeader.slot,
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
  const signatureSet = getBlockHeaderProposerSignatureSetByParentStateSlot(
    blockState,
    dataColumnSidecar.signedBlockHeader
  );

  if (!chain.seenBlockInputCache.isVerifiedProposerSignature(blockHeader.slot, blockRootHex)) {
    if (
      !(await chain.bls.verifySignatureSets([signatureSet], {
        // verify on main thread so that we only need to verify block proposer signature once per block
        verifyOnMainThread: true,
      }))
    ) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
        blockRoot: blockRootHex,
        index: dataColumnSidecar.index,
        slot: blockHeader.slot,
      });
    }

    chain.seenBlockInputCache.markVerifiedProposerSignature(blockHeader.slot, blockRootHex);
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
      columnIndex: dataColumnSidecar.index,
    });
  }

  const kzgProofTimer = metrics?.peerDas.dataColumnSidecarKzgProofsVerificationTime.startTimer();
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
      columnIndex: dataColumnSidecar.index,
    });
  } finally {
    kzgProofTimer?.();
  }

  // 12) [IGNORE] The sidecar is the first sidecar for the tuple (block_header.slot, block_header.proposer_index,
  //              sidecar.index) with valid header signature, sidecar inclusion proof, and kzg proof
  //              -- Handled in seenGossipBlockInput
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#verify_data_column_sidecar
 */
function verifyDataColumnSidecar(config: ChainForkConfig, dataColumnSidecar: fulu.DataColumnSidecar): void {
  if (dataColumnSidecar.index >= NUMBER_OF_COLUMNS) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_INDEX,
      slot: dataColumnSidecar.signedBlockHeader.message.slot,
      columnIndex: dataColumnSidecar.index,
    });
  }

  if (dataColumnSidecar.kzgCommitments.length === 0) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.NO_COMMITMENTS,
      slot: dataColumnSidecar.signedBlockHeader.message.slot,
      columnIndex: dataColumnSidecar.index,
    });
  }

  const epoch = computeEpochAtSlot(dataColumnSidecar.signedBlockHeader.message.slot);
  const maxBlobsPerBlock = config.getMaxBlobsPerBlock(epoch);

  if (dataColumnSidecar.kzgCommitments.length > maxBlobsPerBlock) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.TOO_MANY_KZG_COMMITMENTS,
      slot: dataColumnSidecar.signedBlockHeader.message.slot,
      columnIndex: dataColumnSidecar.index,
      count: dataColumnSidecar.kzgCommitments.length,
      limit: maxBlobsPerBlock,
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
    valid = await kzg.asyncVerifyCellKzgProofBatch(commitments, cellIndices, cells, proofs);
  } catch (e) {
    (e as Error).message = `Error on asyncVerifyCellKzgProofBatch: ${(e as Error).message}`;
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
 * Validate a subset of data column sidecars in a block
 *
 * Requires the block to be known to the node
 *
 * NOTE: chain is optional to skip signature verification. Helpful for testing purposes and so that can control whether
 * signature gets checked depending on the reqresp method that is being checked
 */
export async function validateBlockDataColumnSidecars(
  chain: IBeaconChain | null,
  blockSlot: Slot,
  blockRoot: Root,
  blockBlobCount: number,
  dataColumnSidecars: fulu.DataColumnSidecars
): Promise<void> {
  if (dataColumnSidecars.length === 0) {
    return;
  }

  if (blockBlobCount === 0) {
    throw new DataColumnSidecarValidationError(
      {
        code: DataColumnSidecarErrorCode.INCORRECT_SIDECAR_COUNT,
        slot: blockSlot,
        expected: 0,
        actual: dataColumnSidecars.length,
      },
      "Block has no blob commitments but data column sidecars were provided"
    );
  }
  // Hash the first sidecar block header and compare the rest via (cheaper) equality
  const firstSidecarSignedBlockHeader = dataColumnSidecars[0].signedBlockHeader;
  const firstSidecarBlockHeader = firstSidecarSignedBlockHeader.message;
  const firstBlockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(firstSidecarBlockHeader);
  if (Buffer.compare(blockRoot, firstBlockRoot) !== 0) {
    throw new DataColumnSidecarValidationError(
      {
        code: DataColumnSidecarErrorCode.INCORRECT_BLOCK,
        slot: blockSlot,
        columnIndex: 0,
        expected: toRootHex(blockRoot),
        actual: toRootHex(firstBlockRoot),
      },
      "DataColumnSidecar doesn't match corresponding block"
    );
  }

  if (chain !== null) {
    const rootHex = toRootHex(blockRoot);
    const slot = firstSidecarSignedBlockHeader.message.slot;
    if (!chain.seenBlockInputCache.isVerifiedProposerSignature(slot, rootHex)) {
      const headState = await chain.getHeadState();
      const signatureSet = getBlockHeaderProposerSignatureSetByHeaderSlot(headState, firstSidecarSignedBlockHeader);

      if (
        !(await chain.bls.verifySignatureSets([signatureSet], {
          verifyOnMainThread: true,
        }))
      ) {
        throw new DataColumnSidecarValidationError({
          code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
          blockRoot: rootHex,
          slot: blockSlot,
          index: dataColumnSidecars[0].index,
        });
      }

      chain.seenBlockInputCache.markVerifiedProposerSignature(slot, rootHex);
    }
  }

  const commitments: Uint8Array[] = [];
  const cellIndices: number[] = [];
  const cells: Uint8Array[] = [];
  const proofs: Uint8Array[] = [];
  for (let i = 0; i < dataColumnSidecars.length; i++) {
    const columnSidecar = dataColumnSidecars[i];

    if (
      i !== 0 &&
      !ssz.phase0.SignedBeaconBlockHeader.equals(firstSidecarSignedBlockHeader, columnSidecar.signedBlockHeader)
    ) {
      throw new DataColumnSidecarValidationError({
        code: DataColumnSidecarErrorCode.INCORRECT_HEADER_ROOT,
        slot: blockSlot,
        expected: toRootHex(blockRoot),
        actual: toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(columnSidecar.signedBlockHeader.message)),
      });
    }

    if (columnSidecar.index >= NUMBER_OF_COLUMNS) {
      throw new DataColumnSidecarValidationError(
        {
          code: DataColumnSidecarErrorCode.INVALID_INDEX,
          slot: blockSlot,
          columnIndex: columnSidecar.index,
        },
        "DataColumnSidecar has invalid index"
      );
    }

    if (columnSidecar.column.length !== blockBlobCount) {
      throw new DataColumnSidecarValidationError({
        code: DataColumnSidecarErrorCode.INCORRECT_CELL_COUNT,
        slot: blockSlot,
        columnIndex: columnSidecar.index,
        expected: blockBlobCount,
        actual: columnSidecar.column.length,
      });
    }

    if (columnSidecar.column.length !== columnSidecar.kzgCommitments.length) {
      throw new DataColumnSidecarValidationError({
        code: DataColumnSidecarErrorCode.INCORRECT_KZG_COMMITMENTS_COUNT,
        slot: blockSlot,
        columnIndex: columnSidecar.index,
        expected: columnSidecar.column.length,
        actual: columnSidecar.kzgCommitments.length,
      });
    }

    if (columnSidecar.column.length !== columnSidecar.kzgProofs.length) {
      throw new DataColumnSidecarValidationError({
        code: DataColumnSidecarErrorCode.INCORRECT_KZG_PROOF_COUNT,
        slot: blockSlot,
        columnIndex: columnSidecar.index,
        expected: columnSidecar.column.length,
        actual: columnSidecar.kzgProofs.length,
      });
    }

    if (!verifyDataColumnSidecarInclusionProof(columnSidecar)) {
      throw new DataColumnSidecarValidationError(
        {
          code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
          slot: blockSlot,
          columnIndex: columnSidecar.index,
        },
        "DataColumnSidecar has invalid inclusion proof"
      );
    }

    commitments.push(...columnSidecar.kzgCommitments);
    cellIndices.push(...Array.from({length: columnSidecar.column.length}, () => columnSidecar.index));
    cells.push(...columnSidecar.column);
    proofs.push(...columnSidecar.kzgProofs);
  }

  let reason: string | undefined;
  try {
    const valid = await kzg.asyncVerifyCellKzgProofBatch(commitments, cellIndices, cells, proofs);
    if (!valid) {
      reason = "Invalid KZG proof batch";
    }
  } catch (e) {
    reason = (e as Error).message;
  }
  if (reason !== undefined) {
    throw new DataColumnSidecarValidationError(
      {
        code: DataColumnSidecarErrorCode.INVALID_KZG_PROOF_BATCH,
        slot: blockSlot,
        reason,
      },
      "DataColumnSidecar has invalid KZG proof batch"
    );
  }
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/p2p-interface.md#compute_subnet_for_data_column_sidecar
 */
export function computeSubnetForDataColumnSidecar(
  config: ChainConfig,
  columnSidecar: fulu.DataColumnSidecar
): SubnetID {
  return columnSidecar.index % config.DATA_COLUMN_SIDECAR_SUBNET_COUNT;
}
