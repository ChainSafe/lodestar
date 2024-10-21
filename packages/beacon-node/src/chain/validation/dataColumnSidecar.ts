import {
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENTS_SUBTREE_INDEX,
  DATA_COLUMN_SIDECAR_SUBNET_COUNT,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {ssz, deneb, peerdas, Slot, Root} from "@lodestar/types";
import {toHex, verifyMerkleBranch} from "@lodestar/utils";

import {DataColumnSidecarGossipError, DataColumnSidecarErrorCode} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";
import {ckzg} from "../../util/kzg.js";
import {byteArrayEquals} from "../../util/bytes.js";

export async function validateGossipDataColumnSidecar(
  chain: IBeaconChain,
  dataColumnSideCar: peerdas.DataColumnSidecar,
  gossipIndex: number
): Promise<void> {
  const dataColumnSlot = dataColumnSideCar.signedBlockHeader.message.slot;

  if (
    dataColumnSideCar.index > NUMBER_OF_COLUMNS ||
    dataColumnSideCar.index % DATA_COLUMN_SIDECAR_SUBNET_COUNT !== gossipIndex
  ) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INVALID_INDEX,
      columnIndex: dataColumnSideCar.index,
      gossipIndex,
    });
  }

  // [IGNORE] The sidecar is not from a future slot (with a MAXIMUM_GOSSIP_CLOCK_DISPARITY allowance) --
  // i.e. validate that sidecar.slot <= current_slot (a client MAY queue future blocks for processing at
  // the appropriate slot).
  const currentSlotWithGossipDisparity = chain.clock.currentSlotWithGossipDisparity;
  if (currentSlotWithGossipDisparity < dataColumnSlot) {
    throw new DataColumnSidecarGossipError(GossipAction.IGNORE, {
      code: DataColumnSidecarErrorCode.FUTURE_SLOT,
      currentSlot: currentSlotWithGossipDisparity,
      blockSlot: dataColumnSlot,
    });
  }

  if (!validateInclusionProof(dataColumnSideCar)) {
    throw new DataColumnSidecarGossipError(GossipAction.REJECT, {
      code: DataColumnSidecarErrorCode.INCLUSION_PROOF_INVALID,
      slot: dataColumnSideCar.signedBlockHeader.message.slot,
      columnIdx: dataColumnSideCar.index,
    });
  }
}

export function validateDataColumnsSidecars(
  blockSlot: Slot,
  blockRoot: Root,
  blockKzgCommitments: deneb.BlobKzgCommitments,
  dataColumnSidecars: peerdas.DataColumnSidecars,
  opts: {skipProofsCheck: boolean} = {skipProofsCheck: false}
): void {
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
    cellIndices.push(...Array.from({length: column.length}, () => columnIndex));
    cells.push(...column);
    proofBytes.push(...kzgProofs);
  }

  if (opts.skipProofsCheck) {
    return;
  }

  let valid: boolean;
  try {
    valid = ckzg.verifyCellKzgProofBatch(commitmentBytes, cellIndices, cells, proofBytes);
  } catch (err) {
    (err as Error).message = `Error in verifyCellKzgProofBatch for slot=${blockSlot} blockRoot=${toHex(blockRoot)}`;
    throw err;
  }

  if (!valid) {
    throw new Error(`Invalid data column sidecars in slot=${blockSlot} blockRoot=${toHex(blockRoot)}`);
  }
}

function validateInclusionProof(dataColumnSidecar: peerdas.DataColumnSidecar): boolean {
  return verifyMerkleBranch(
    ssz.deneb.BlobKzgCommitments.hashTreeRoot(dataColumnSidecar.kzgCommitments),
    dataColumnSidecar.kzgCommitmentsInclusionProof,
    KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
    KZG_COMMITMENTS_SUBTREE_INDEX,
    dataColumnSidecar.signedBlockHeader.message.bodyRoot
  );
}
