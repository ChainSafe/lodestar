import {digest as sha256Digest} from "@chainsafe/as-sha256";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {VERSIONED_HASH_VERSION_KZG, KZG_COMMITMENT_GINDEX0, KZG_COMMITMENTS_GINDEX, ForkName, ForkAll, NUMBER_OF_COLUMNS} from "@lodestar/params";
import {deneb, ssz, BeaconBlockBody, SignedBeaconBlock, SSZTypesFor} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {ckzg} from "./kzg.js";

type VersionHash = Uint8Array;

export function kzgCommitmentToVersionedHash(kzgCommitment: deneb.KZGCommitment): VersionHash {
  const hash = sha256Digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}

export function computeInclusionProof(
  fork: ForkName,
  body: BeaconBlockBody,
  index: number
): deneb.KzgCommitmentInclusionProof {
  const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkAll, "BeaconBlockBody">).toView(body);
  const commitmentGindex = KZG_COMMITMENT_GINDEX0 + index;
  return new Tree(bodyView.node).getSingleProof(BigInt(commitmentGindex));
}

export function computeKzgCommitmentsInclusionProof(
  fork: ForkName,
  body: BeaconBlockBody
): electra.KzgCommitmentsInclusionProof {
  const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkAll, "BeaconBlockBody">).toView(body);
  return new Tree(bodyView.node).getSingleProof(BigInt(KZG_COMMITMENTS_GINDEX));
}

export function computeBlobSidecars(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock,
  contents: deneb.Contents & {kzgCommitmentInclusionProofs?: deneb.KzgCommitmentInclusionProof[]}
): deneb.BlobSidecars {
  const blobKzgCommitments = (signedBlock as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;
  if (blobKzgCommitments === undefined) {
    throw Error("Invalid block with missing blobKzgCommitments for computeBlobSidecars");
  }

  const signedBlockHeader = signedBlockToSignedHeader(config, signedBlock);
  const fork = config.getForkName(signedBlockHeader.message.slot);

  return blobKzgCommitments.map((kzgCommitment, index) => {
    const blob = contents.blobs[index];
    const kzgProof = contents.kzgProofs[index];
    const kzgCommitmentInclusionProof =
      contents.kzgCommitmentInclusionProofs?.[index] ?? computeInclusionProof(fork, signedBlock.message.body, index);

    return {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
  });
}

export function computeDataColumnSidecars(
  config: ChainForkConfig,
  signedBlock: SignedBeaconBlock,
  contents: deneb.Contents & {kzgCommitmentsInclusionProof?: electra.KzgCommitmentsInclusionProof}
): electra.DataColumnSidecars {
  const blobKzgCommitments = (signedBlock as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;
  if (blobKzgCommitments === undefined) {
    throw Error("Invalid block with missing blobKzgCommitments for computeBlobSidecars");
  }
  if (blobKzgCommitments.length === 0) {
    return [];
  }

  const signedBlockHeader = signedBlockToSignedHeader(config, signedBlock);
  const fork = config.getForkName(signedBlockHeader.message.slot);
  const kzgCommitmentsInclusionProof =
    contents.kzgCommitmentsInclusionProof ?? computeKzgCommitmentsInclusionProof(fork, signedBlock.message.body);
  const cellsAndProofs = contents.blobs.map((blob) => ckzg.computeCellsAndKzgProofs(blob));
  const dataColumnSidecars = Array.from({length: NUMBER_OF_COLUMNS}, (_, j) => {
    // j'th column
    const column = Array.from({length: contents.blobs.length}, (_, i) => cellsAndProofs[i][0][j]);
    const kzgProofs = Array.from({length: contents.blobs.length}, (_, i) => cellsAndProofs[i][1][j]);

    const dataColumnSidecar = {
      index: j,
      column,
      kzgCommitments: blobKzgCommitments,
      kzgProofs,
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    } as electra.DataColumnSidecar;

    return dataColumnSidecar;
  });

  return dataColumnSidecars;
}
