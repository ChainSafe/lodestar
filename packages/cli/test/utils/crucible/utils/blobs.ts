import {digest as sha256Digest} from "@chainsafe/as-sha256";
import {ckzg} from "@lodestar/beacon-node/util";
import {BYTES_PER_FIELD_ELEMENT, FIELD_ELEMENTS_PER_BLOB, VERSIONED_HASH_VERSION_KZG} from "@lodestar/params";
import {deneb} from "@lodestar/types";
import {toHex} from "@lodestar/utils/node";

export function generateBlobsForTransaction(count: number): {
  blobs: string[];
  kzgCommitments: string[];
  blobVersionedHashes: string[];
  kzgProofs: string[];
} {
  const blobs = Array.from({length: count}, () => generateRandomBlob());
  const kzgCommitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
  const versionedHash = kzgCommitments.map((kzgCommitment) => kzgCommitmentToVersionedHash(kzgCommitment));
  const kzgProofs = blobs.map((blob, index) => ckzg.computeBlobKzgProof(blob, kzgCommitments[index]));

  return {
    blobs: blobs.map((blob) => toHex(blob)),
    kzgCommitments: kzgCommitments.map((kzgCommitment) => toHex(kzgCommitment)),
    blobVersionedHashes: versionedHash.map((hash) => toHex(hash)),
    kzgProofs: kzgProofs.map((proof) => toHex(proof)),
  };
}

function generateRandomBlob(): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB; i++) {
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, i);
  }
  return blob;
}

export function kzgCommitmentToVersionedHash(kzgCommitment: deneb.KZGCommitment): Uint8Array {
  const hash = sha256Digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}
