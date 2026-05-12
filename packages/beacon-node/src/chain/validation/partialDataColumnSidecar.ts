import {KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH, KZG_COMMITMENTS_SUBTREE_INDEX} from "@lodestar/params";
import {computeStartSlotAtEpoch, getBlockHeaderProposerSignatureSetByParentStateSlot} from "@lodestar/state-transition";
import {ColumnIndex, Slot, deneb, fulu, ssz} from "@lodestar/types";
import {toRootHex, verifyMerkleBranch} from "@lodestar/utils";
import {Metrics} from "../../metrics/metrics.js";
import {PartialDataColumnSidecar} from "../../util/dataColumns.js";
import {kzg} from "../../util/kzg.js";
import {DataColumnSidecarErrorCode, DataColumnSidecarGossipError} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/interface.js";

/**
 * Verify the KZG commitments inclusion proof in a PartialDataColumnHeader.
 * Same logic as verifyDataColumnSidecarInclusionProof but on the header container.
 *
 * SPEC: verify_partial_data_column_header_inclusion_proof
 * https://github.com/ethereum/consensus-specs/pull/4558
 */
export function verifyPartialDataColumnHeaderInclusionProof(header: fulu.PartialDataColumnHeader): boolean {
  return verifyMerkleBranch(
    ssz.deneb.BlobKzgCommitments.hashTreeRoot(header.kzgCommitments),
    header.kzgCommitmentsInclusionProof,
    KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
    KZG_COMMITMENTS_SUBTREE_INDEX,
    header.signedBlockHeader.message.bodyRoot
  );
}

/**
 * Verify KZG proofs for a partial set of cells.
 *
 * SPEC: verify_partial_data_column_sidecar_kzg_proofs
 * https://github.com/ethereum/consensus-specs/pull/4558
 */
export async function verifyPartialDataColumnSidecarKzgProofs(
  sidecar: PartialDataColumnSidecar,
  allCommitments: Uint8Array[],
  columnIndex: ColumnIndex
): Promise<void> {
  const blobIndices: number[] = [];
  for (let i = 0; i < sidecar.cellsPresentBitmap.bitLen; i++) {
    if (sidecar.cellsPresentBitmap.get(i)) {
      blobIndices.push(i);
    }
  }

  // The cell index is the column index for all cells in this column
  const cellIndices = blobIndices.map(() => columnIndex);
  const commitments = blobIndices.map((i) => allCommitments[i]);

  let valid: boolean;
  try {
    valid = await kzg.asyncVerifyCellKzgProofBatch(commitments, cellIndices, sidecar.partialColumn, sidecar.kzgProofs);
  } catch (e) {
    (e as Error).message = `Error on partial asyncVerifyCellKzgProofBatch: ${(e as Error).message}`;
    throw e;
  }
  if (!valid) {
    throw Error("Invalid partial verifyCellKzgProofBatch");
  }
}

/**
 * Validate the header portion of a partial data column gossip message.
 *
 * SPEC: "Partial Messages on data_column_sidecar_{subnet_id}" - header validation
 * https://github.com/ethereum/consensus-specs/pull/4558
 */
export async function validateGossipPartialDataColumnHeader(
  chain: IBeaconChain,
  header: fulu.PartialDataColumnHeader,
  blockRootHex: string,
  metrics: Metrics | null
): Promise<void> {
  const validationTimer = metrics?.partialColumns.headerValidationTime.startTimer();

  try {
    const blockHeader = header.signedBlockHeader.message;

    // [REJECT] The header's kzg_commitments list is non-empty
    if (header.kzgCommitments.length === 0) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.NO_COMMITMENTS,
        slot: blockHeader.slot,
        columnIndex: 0,
      });
    }

    // [REJECT] The hash of the block header matches the group id
    const headerBlockRoot = toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader));
    if (headerBlockRoot !== blockRootHex) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.PARTIAL_HEADER_MISMATCH,
        slot: blockHeader.slot,
        columnIndex: 0,
      });
    }

    // [IGNORE] Not from future slot (with MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
    const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
    if (currentSlotWithGossipDisparity < blockHeader.slot) {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.FUTURE_SLOT,
        currentSlot: currentSlotWithGossipDisparity,
        blockSlot: blockHeader.slot,
      });
    }

    // [IGNORE] From slot greater than finalized
    const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
    const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
    if (blockHeader.slot <= finalizedSlot) {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT,
        blockSlot: blockHeader.slot,
        finalizedSlot,
      });
    }

    // [IGNORE] Parent has been seen (via gossip or non-gossip sources)
    const parentRoot = toRootHex(blockHeader.parentRoot);
    const parentBlock = chain.forkChoice.getBlockHexDefaultStatus(parentRoot);
    if (parentBlock === null) {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
        parentRoot,
        slot: blockHeader.slot,
      });
    }

    // [REJECT] From higher slot than parent
    if (parentBlock.slot >= blockHeader.slot) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT,
        parentSlot: parentBlock.slot,
        slot: blockHeader.slot,
      });
    }

    // Get block state for proposer verification
    const blockState = await chain.regen
      .getBlockSlotState(parentBlock, blockHeader.slot, {dontTransferCache: true}, RegenCaller.validateGossipDataColumn)
      .catch(() => {
        throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
          code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
          parentRoot,
          slot: blockHeader.slot,
        });
      });

    // [REJECT] Expected proposer_index
    const proposerIndex = blockHeader.proposerIndex;
    const expectedProposerIndex = blockState.getBeaconProposer(blockHeader.slot);
    if (proposerIndex !== expectedProposerIndex) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.INCORRECT_PROPOSER,
        actualProposerIndex: proposerIndex,
        expectedProposerIndex,
      });
    }

    // [REJECT] Proposer signature valid
    const signature = header.signedBlockHeader.signature;
    if (!chain.seenBlockInputCache.isVerifiedProposerSignature(blockHeader.slot, blockRootHex, signature)) {
      const signatureSet = getBlockHeaderProposerSignatureSetByParentStateSlot(
        chain.config,
        blockState.slot,
        header.signedBlockHeader
      );
      if (
        !(await chain.bls.verifySignatureSets([signatureSet], {
          verifyOnMainThread: true,
        }))
      ) {
        throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
          code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
          blockRoot: blockRootHex,
          index: 0,
          slot: blockHeader.slot,
        });
      }
      chain.seenBlockInputCache.markVerifiedProposerSignature(blockHeader.slot, blockRootHex, signature);
    }

    // [REJECT] Inclusion proof valid
    const timer = metrics?.peerDas.dataColumnSidecarInclusionProofVerificationTime.startTimer();
    const valid = verifyPartialDataColumnHeaderInclusionProof(header);
    timer?.();

    if (!valid) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
        slot: blockHeader.slot,
        columnIndex: 0,
      });
    }
  } finally {
    validationTimer?.();
  }
}

/**
 * Validate the cell portion of a partial data column gossip message.
 *
 * SPEC: "Partial Messages on data_column_sidecar_{subnet_id}" - cell validation
 * https://github.com/ethereum/consensus-specs/pull/4558
 */
export async function validateGossipPartialDataColumnCells(
  sidecar: PartialDataColumnSidecar,
  context: {slot: Slot; kzgCommitments: deneb.BlobKzgCommitments},
  columnIndex: ColumnIndex,
  metrics: Metrics | null
): Promise<void> {
  const validationTimer = metrics?.partialColumns.cellValidationTime.startTimer();

  try {
    // [REJECT] bitmap length equals number of commitments
    if (sidecar.cellsPresentBitmap.bitLen !== context.kzgCommitments.length) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.PARTIAL_BITMAP_LENGTH_MISMATCH,
        slot: context.slot,
        columnIndex,
      });
    }

    // [REJECT] Same number of cells and proofs
    if (sidecar.partialColumn.length !== sidecar.kzgProofs.length) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.PARTIAL_CELL_PROOF_COUNT_MISMATCH,
        slot: context.slot,
        columnIndex,
      });
    }

    // [REJECT] Number of cells matches bitmap popcount
    let bitmapPopcount = 0;
    for (let i = 0; i < sidecar.cellsPresentBitmap.bitLen; i++) {
      if (sidecar.cellsPresentBitmap.get(i)) bitmapPopcount++;
    }
    if (sidecar.partialColumn.length !== bitmapPopcount) {
      throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
        code: DataColumnSidecarErrorCode.PARTIAL_CELL_PROOF_COUNT_MISMATCH,
        slot: context.slot,
        columnIndex,
      });
    }

    // [REJECT] KZG proofs valid
    if (sidecar.partialColumn.length > 0) {
      const kzgTimer = metrics?.peerDas.dataColumnSidecarKzgProofsVerificationTime.startTimer();
      try {
        await verifyPartialDataColumnSidecarKzgProofs(sidecar, context.kzgCommitments, columnIndex);
      } catch {
        throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
          code: DataColumnSidecarErrorCode.PARTIAL_INVALID_KZG_PROOF,
          slot: context.slot,
          columnIndex,
        });
      } finally {
        kzgTimer?.();
      }
    }
  } finally {
    validationTimer?.();
  }
}
