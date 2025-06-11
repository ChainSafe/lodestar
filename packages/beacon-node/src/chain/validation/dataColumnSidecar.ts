import {
  DATA_COLUMN_SIDECAR_SUBNET_COUNT,
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENTS_SUBTREE_INDEX,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {Root, Slot, SubnetID, deneb, fulu, ssz} from "@lodestar/types";
import {toHex, toRootHex, verifyMerkleBranch} from "@lodestar/utils";

import {computeStartSlotAtEpoch, getBlockHeaderProposerSignatureSet} from "@lodestar/state-transition";
import {Metrics} from "../../metrics/metrics.js";
import {byteArrayEquals} from "../../util/bytes.js";
import {kzg} from "../../util/kzg.js";
import {Result} from "../../util/wrapError.js";
import {DataColumnSidecarErrorCode, DataColumnSidecarGossipError} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";
import {RegenCaller} from "../regen/interface.js";

export type GossipDataColumnSidecar = {
  sidecar: fulu.DataColumnSidecar;
  subnet: SubnetID;
};

export enum VerificationDataColumnBatchSource {
  Gossip = "gossip",
  VerifyBlock = "verify_block",
}

// The spec function to verify an individual DataColumnSidecar
// https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#data_column_sidecar_subnet_id
// here we do it in batch to:
// - efficiently verify proofs
// - verify inclusion proof once
// - verify signatures once
export async function validateGossipDataColumnSidecarSameBlock(
  chain: IBeaconChain,
  sidecars: GossipDataColumnSidecar[]
): Promise<Result<void>[]> {
  // there is always at least one sidecar as checked in gossip handler
  const results: Result<void>[] = new Array<Result<void>>(sidecars.length);

  // all sidecars are from the same block thanks to the IndexedGossipQueueMinSize
  const signedBlockHeader = sidecars[0].sidecar.signedBlockHeader;
  const blockHeader = signedBlockHeader.message;
  const sidecarSlot = blockHeader.slot;
  const clockSlot = chain.clock.currentSlot;

  chain.metrics?.gossipDataColumnSidecar.sidecarSlotToClockSlot.observe(clockSlot - sidecarSlot);
  if (sidecars.length === 1) {
    chain.metrics?.gossipDataColumnSidecar.nonBatchCount.inc();
  } else if (sidecars.length > 1) {
    chain.metrics?.gossipDataColumnSidecar.batchHistogram.observe(sidecars.length);
  } else {
    // should not happen, consumer checked there is at least one sidecar already
    throw new Error("validateGossipDataColumnSidecarSameBlock called with no sidecars");
  }

  for (const [i, {sidecar, subnet}] of sidecars.entries()) {
    // 1) [REJECT] The sidecar is valid as verified by verify_data_column_sidecar
    verifyDataColumnSidecar(sidecar);

    // 2) [REJECT] The sidecar is for the correct subnet -- i.e. compute_subnet_for_data_column_sidecar(sidecar.index) == subnet_id
    if (computeSubnetForDataColumnSidecar(sidecar) !== subnet) {
      results[i] = {
        err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
          code: DataColumnSidecarErrorCode.INVALID_SUBNET,
          columnIdx: sidecar.index,
          gossipSubnet: subnet,
        }),
      };
    }
  }

  // 3) [IGNORE] The sidecar is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance)
  //             -- i.e. validate that sidecar.slot <= current_slot (a client MAY queue future blocks
  //             for processing at the appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < sidecarSlot) {
    for (let i = 0; i < sidecars.length; i++) {
      if (results[i] === undefined) {
        results[i] = {
          err: new DataColumnSidecarGossipError(GossipAction.IGNORE, {
            code: DataColumnSidecarErrorCode.FUTURE_SLOT,
            currentSlot: currentSlotWithGossipDisparity,
            blockSlot: sidecarSlot,
          }),
        };
      }
    }

    return results;
  }

  // 4) [IGNORE] The sidecar is from a slot greater than the latest finalized slot -- i.e. validate that
  //             sidecar.slot > compute_start_slot_at_epoch(state.finalized_checkpoint.epoch)
  const finalizedCheckpoint = chain.forkChoice.getFinalizedCheckpoint();
  const finalizedSlot = computeStartSlotAtEpoch(finalizedCheckpoint.epoch);
  if (sidecarSlot <= finalizedSlot) {
    for (let i = 0; i < sidecars.length; i++) {
      if (results[i] === undefined) {
        results[i] = {
          err: new DataColumnSidecarGossipError(GossipAction.IGNORE, {
            code: DataColumnSidecarErrorCode.WOULD_REVERT_FINALIZED_SLOT,
            blockSlot: sidecarSlot,
            finalizedSlot,
          }),
        };
      }
    }

    return results;
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
    for (let i = 0; i < sidecars.length; i++) {
      if (results[i] === undefined) {
        results[i] = {
          err: new DataColumnSidecarGossipError(GossipAction.IGNORE, {
            code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
            parentRoot,
          }),
        };
      }
    }

    return results;
  }

  // 8) [REJECT] The sidecar is from a higher slot than the sidecar's block's parent
  if (parentBlock.slot >= sidecarSlot) {
    for (let i = 0; i < sidecars.length; i++) {
      if (results[i] === undefined) {
        results[i] = {
          err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
            code: DataColumnSidecarErrorCode.NOT_LATER_THAN_PARENT,
            parentSlot: parentBlock.slot,
            slot: sidecarSlot,
          }),
        };
      }
    }

    return results;
  }

  // getBlockSlotState also checks for whether the current finalized checkpoint is an ancestor of the block.
  // As a result, we throw an IGNORE (whereas the spec says we should REJECT for this scenario).
  // this is something we should change this in the future to make the code airtight to the spec.
  // 7) [REJECT] The sidecar's block's parent passes validation.
  const blockState = await chain.regen
    .getBlockSlotState(parentRoot, sidecarSlot, {dontTransferCache: true}, RegenCaller.validateGossipBlock)
    .catch(() => {
      throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
        code: DataColumnSidecarErrorCode.PARENT_UNKNOWN,
        parentRoot,
      });
    });

  // 5) [REJECT] The proposer signature of sidecar.signed_block_header, is valid with respect to the block_header.proposer_index pubkey.
  const signatureSet = getBlockHeaderProposerSignatureSet(blockState, signedBlockHeader);
  if (
    // TODO-das: verify this once per block for all DataColumnSidecars using the new BlockInput
    !(await chain.bls.verifySignatureSets([signatureSet], {
      verifyOnMainThread: sidecarSlot > chain.forkChoice.getHead().slot,
    }))
  ) {
    for (let i = 0; i < sidecars.length; i++) {
      if (results[i] === undefined) {
        results[i] = {
          err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
            code: DataColumnSidecarErrorCode.PROPOSAL_SIGNATURE_INVALID,
          }),
        };
      }
    }

    return results;
  }

  // 9) [REJECT] The current finalized_checkpoint is an ancestor of the sidecar's block
  //             -- i.e. get_checkpoint_block(store, block_header.parent_root, store.finalized_checkpoint.epoch)
  //                     == store.finalized_checkpoint.root
  // Handled by 7)

  // 10) [REJECT] The sidecar's kzg_commitments field inclusion proof is valid as verified by
  //              verify_data_column_sidecar_inclusion_proof
  //              TODO (fulu): verify once using the new BlockInput if same inclusion proof
  let verifiedInclusionProof: fulu.DataColumnSidecar | null = null;
  for (const [i, {sidecar}] of sidecars.entries()) {
    if (results[i] !== undefined) {
      // already rejected or ignored
      continue;
    }

    if (verifiedInclusionProof == null) {
      const timer = chain.metrics?.peerDas.dataColumnSidecarInclusionProofVerificationTime.startTimer();
      if (verifyDataColumnSidecarInclusionProof(sidecar)) {
        verifiedInclusionProof = sidecar;
      } else {
        results[i] = {
          err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
            code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
            slot: sidecar.signedBlockHeader.message.slot,
            columnIdx: sidecar.index,
          }),
        };
      }
      timer?.();
    } else {
      if (isSameInclusionProof(verifiedInclusionProof, sidecar)) {
        // already verified
        continue;
      }

      results[i] = {
        err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
          code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
          slot: sidecar.signedBlockHeader.message.slot,
          columnIdx: sidecar.index,
        }),
      };
    }
  }

  // 11) [REJECT] The sidecar's column data is valid as verified by verify_data_column_sidecar_kzg_proofs
  const commitmentBytes: Uint8Array[] = [];
  const cellIndices: bigint[] = [];
  const cells: Uint8Array[] = [];
  const proofBytes: Uint8Array[] = [];
  for (const [i, {sidecar}] of sidecars.entries()) {
    if (results[i] !== undefined) {
      // already rejected or ignored
      continue;
    }
    const {column, index: columnIndex, kzgProofs} = sidecar;

    commitmentBytes.push(...sidecar.kzgCommitments);
    cellIndices.push(...Array.from({length: column.length}, () => BigInt(columnIndex)));
    cells.push(...column);
    proofBytes.push(...kzgProofs);
  }

  if (commitmentBytes.length > 0 && cells.length > 0 && cells.length > 0 && proofBytes.length > 0) {
    let valid: boolean;
    try {
      const timer = chain.metrics?.peerDas.kzgVerificationDataColumnBatchTime.startTimer({
        source: VerificationDataColumnBatchSource.Gossip,
      });
      valid = await kzg.asyncVerifyCellKzgProofBatch(commitmentBytes, cellIndices, cells, proofBytes);
      timer?.();
    } catch (_e) {
      valid = false;
    }

    if (!valid) {
      for (const [i, {sidecar}] of sidecars.entries()) {
        if (results[i] !== undefined) {
          // already rejected or ignored
          continue;
        }
        chain.metrics?.peerDas.kzgVerificationDataColumnBatchReverify.inc();

        try {
          verifyDataColumnSidecarKzgProofs(
            sidecar.kzgCommitments,
            Array.from({length: sidecar.column.length}, () => BigInt(sidecar.index)),
            sidecar.column,
            sidecar.kzgProofs
          );
        } catch (_e) {
          results[i] = {
            err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
              code: DataColumnSidecarErrorCode.INVALID_KZG_PROOF,
              slot: sidecarSlot,
              columnIdx: sidecar.index,
            }),
          };
        }
      }
    }
  }

  // 12) [IGNORE] The sidecar is the first sidecar for the tuple (block_header.slot, block_header.proposer_index,
  //              sidecar.index) with valid header signature, sidecar inclusion proof, and kzg proof
  //              -- Handled in seenGossipBlockInput

  // 13) [REJECT] The sidecar is proposed by the expected proposer_index for the block's slot in the context of the current
  //              shuffling (defined by block_header.parent_root/block_header.slot). If the proposer_index cannot
  //              immediately be verified against the expected shuffling, the sidecar MAY be queued for later processing
  //              while proposers for the block's branch are calculated -- in such a case do not REJECT, instead IGNORE
  //              this message.
  const proposerIndex = blockHeader.proposerIndex;
  const expectedProposerIndex = blockState.epochCtx.getBeaconProposer(sidecarSlot);

  if (proposerIndex !== expectedProposerIndex) {
    for (let i = 0; i < sidecars.length; i++) {
      if (results[i] !== undefined) {
        // already rejected or ignored
        continue;
      }

      results[i] = {
        err: new DataColumnSidecarGossipError(GossipAction.REJECT, {
          code: DataColumnSidecarErrorCode.INCORRECT_PROPOSER,
          actualProposerIndex: proposerIndex,
          expectedProposerIndex,
        }),
      };
    }
  }

  return results;
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
  const cellIndices: bigint[] = [];
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
        `Invalid data column sidecar slot=${columnBlockHeader.slot} columnBlockRoot=${toHex(columnBlockRoot)} columnIndex=${columnIndex} for the block blockRoot=${toHex(blockRoot)} slot=${blockSlot} sidecarsIndex=${sidecarsIndex}`
      );
    }

    if (columnIndex >= NUMBER_OF_COLUMNS) {
      throw new Error(
        `Invalid data sidecar columnIndex=${columnIndex} in slot=${blockSlot} blockRoot=${toHex(blockRoot)} sidecarsIndex=${sidecarsIndex}`
      );
    }

    if (column.length !== kzgCommitments.length || column.length !== kzgProofs.length) {
      throw new Error(
        `Invalid data sidecar array lengths for columnIndex=${columnIndex} in slot=${blockSlot} blockRoot=${toHex(blockRoot)}`
      );
    }

    commitmentBytes.push(...kzgCommitments);
    cellIndices.push(...Array.from({length: column.length}, () => BigInt(columnIndex)));
    cells.push(...column);
    proofBytes.push(...kzgProofs);
  }

  if (opts.skipProofsCheck) {
    return;
  }

  let valid: boolean;
  try {
    const timer = metrics?.peerDas.kzgVerificationDataColumnBatchTime.startTimer({
      source: VerificationDataColumnBatchSource.VerifyBlock,
    });
    valid = await kzg.asyncVerifyCellKzgProofBatch(commitmentBytes, cellIndices, cells, proofBytes);
    timer?.();
  } catch (err) {
    (err as Error).message = `Error in verifyCellKzgProofBatch for slot=${blockSlot} blockRoot=${toHex(blockRoot)}`;
    throw err;
  }

  if (!valid) {
    throw new Error(`Invalid data column sidecars in slot=${blockSlot} blockRoot=${toHex(blockRoot)}`);
  }
}

/**
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#verify_data_column_sidecar
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
 * https://github.com/ethereum/consensus-specs/blob/dev/specs/fulu/p2p-interface.md#verify_data_column_sidecar_kzg_proofs
 */
export async function verifyDataColumnSidecarKzgProofs(
  commitments: Uint8Array[],
  cellIndices: bigint[],
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

/**
 * Check if a DataColumnSidecar inclusion proof is the same to a verified DataColumnSidecar so that we don't have to call
 * verifyDataColumnSidecarInclusionProof() again.
 */
function isSameInclusionProof(verified: fulu.DataColumnSidecar, toCheck: fulu.DataColumnSidecar): boolean {
  if (toCheck.kzgCommitments.length !== verified.kzgCommitments.length) {
    return false;
  }

  if (toCheck.kzgCommitmentsInclusionProof.length !== verified.kzgCommitmentsInclusionProof.length) {
    return false;
  }

  for (let i = 0; i < toCheck.kzgCommitments.length; i++) {
    if (Buffer.compare(toCheck.kzgCommitments[i], verified.kzgCommitments[i]) !== 0) {
      return false;
    }
  }

  for (let i = 0; i < toCheck.kzgCommitmentsInclusionProof.length; i++) {
    if (Buffer.compare(toCheck.kzgCommitmentsInclusionProof[i], verified.kzgCommitmentsInclusionProof[i]) !== 0) {
      return false;
    }
  }

  // signedBlockHeader should be the same thanks to IndexedGossipQueueMinSize
  return true;
}
