import {
  KZG_COMMITMENTS_INCLUSION_PROOF_DEPTH,
  KZG_COMMITMENTS_SUBTREE_INDEX,
  DATA_COLUMN_SIDECAR_SUBNET_COUNT,
  NUMBER_OF_COLUMNS,
} from "@lodestar/params";
import {ssz, deneb, peerdas, Slot, Root} from "@lodestar/types";
import {verifyMerkleBranch} from "@lodestar/utils";

import {DataColumnSidecarGossipError, DataColumnSidecarErrorCode} from "../errors/dataColumnSidecarError.js";
import {GossipAction} from "../errors/gossipValidation.js";
import {IBeaconChain} from "../interface.js";

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

  validateInclusionProof(dataColumnSideCar);
}

export function validateDataColumnsSidecars(
  _blockSlot: Slot,
  _blockRoot: Root,
  _expectedKzgCommitments: deneb.BlobKzgCommitments,
  _dataColumnSidecars: peerdas.DataColumnSidecars,
  _opts: {skipProofsCheck: boolean} = {skipProofsCheck: false}
): void {
  // stubbed
  return;
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
