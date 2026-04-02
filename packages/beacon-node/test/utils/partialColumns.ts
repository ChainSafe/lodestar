import {BYTES_PER_BLOB} from "@crate-crypto/node-eth-kzg";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {ChainForkConfig} from "@lodestar/config";
import {KZG_COMMITMENTS_GINDEX} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {ColumnIndex, Root, Slot, fulu, ssz} from "@lodestar/types";
import {kzg} from "../../src/util/kzg.js";

export function buildDataColumnSidecarFixture({
  chainConfig,
  slot,
  parentRoot,
  proposerIndex,
  columnIndex,
}: {
  chainConfig: ChainForkConfig;
  slot: Slot;
  parentRoot: Root;
  proposerIndex: number;
  columnIndex: ColumnIndex;
}): fulu.DataColumnSidecar {
  const block = ssz.fulu.SignedBeaconBlock.defaultValue();
  block.message.slot = slot;
  block.message.parentRoot = parentRoot;
  block.message.proposerIndex = proposerIndex;

  const blobs = [new Uint8Array(BYTES_PER_BLOB), new Uint8Array(BYTES_PER_BLOB).fill(1)];
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  block.message.body.blobKzgCommitments = kzgCommitments;

  const signedBlockHeader = signedBlockToSignedHeader(chainConfig, block);
  const bodyView = ssz.fulu.BeaconBlockBody.toView(block.message.body);
  const kzgCommitmentsInclusionProof = new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));

  return {
    index: columnIndex,
    column: cellsAndProofs.map(({cells}) => cells[columnIndex]),
    kzgCommitments,
    kzgProofs: cellsAndProofs.map(({proofs}) => proofs[columnIndex]),
    signedBlockHeader,
    kzgCommitmentsInclusionProof,
  };
}
