import SHA256 from "@chainsafe/as-sha256";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {VERSIONED_HASH_VERSION_KZG, KZG_COMMITMENT_GINDEX0, ForkName} from "@lodestar/params";
import {deneb, ssz, allForks} from "@lodestar/types";
import {ChainForkConfig} from "@lodestar/config";

import {blockToHeader} from "./blockRoot.js";

type VersionHash = Uint8Array;

export function kzgCommitmentToVersionedHash(kzgCommitment: deneb.KZGCommitment): VersionHash {
  const hash = SHA256.digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}

export function computeInclusionProof(
  fork: ForkName,
  body: allForks.BeaconBlockBody,
  index: number
): deneb.KzgCommitmentInclusionProof {
  const bodyView = (ssz[fork].BeaconBlockBody as allForks.AllForksSSZTypes["BeaconBlockBody"]).toView(body);
  const commitmentGindex = KZG_COMMITMENT_GINDEX0 + index;
  return new Tree(bodyView.node).getSingleProof(BigInt(commitmentGindex));
}

export function computeBlobSidecars(
  config: ChainForkConfig,
  signedBlock: allForks.SignedBeaconBlock,
  contents: deneb.Contents & {kzgCommitmentInclusionProofs?: deneb.KzgCommitmentInclusionProof[]}
): deneb.BlobSidecars {
  const blobKzgCommitments = (signedBlock as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;
  if (blobKzgCommitments === undefined) {
    throw Error("Invalid block with missing blobKzgCommitments for computeBlobSidecars");
  }

  const blockHeader = blockToHeader(config, signedBlock.message);
  const signedBlockHeader = {message: blockHeader, signature: signedBlock.signature};
  const fork = config.getForkName(blockHeader.slot);

  return blobKzgCommitments.map((kzgCommitment, index) => {
    const blob = contents.blobs[index];
    const kzgProof = contents.kzgProofs[index];
    const kzgCommitmentInclusionProof =
      contents.kzgCommitmentInclusionProofs?.[index] ?? computeInclusionProof(fork, signedBlock.message.body, index);

    return {index, blob, kzgCommitment, kzgProof, signedBlockHeader, kzgCommitmentInclusionProof};
  });
}
