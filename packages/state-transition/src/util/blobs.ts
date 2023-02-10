import SHA256 from "@chainsafe/as-sha256";
import {byteArrayEquals} from "@chainsafe/ssz";
import {BLOB_TX_TYPE, VERSIONED_HASH_VERSION_KZG} from "@lodestar/params";
import {bellatrix, deneb} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

// TODO DENEB: Move to params
const BYTES_PER_HASH = 32;

/**
 * Blob transaction:
 * - 1 byte prefix
 * - class SignedBlobTransaction(Container): message starts at offset 69
 * - class BlobTransaction(Container): blob_versioned_hashes offset value in offset 188, last property in container
 * So to read blob_versioned_hashes:
 * - Read offset value at [70+188, 70+188+4]
 * - Read chunks between offset value and EOF
 * Reference: https://gist.github.com/protolambda/23bd106b66f6d4bb854ce46044aa3ca3
 */
export const OPAQUE_TX_MESSAGE_OFFSET = 70;
export const OPAQUE_TX_BLOB_VERSIONED_HASHES_OFFSET = OPAQUE_TX_MESSAGE_OFFSET + 188;

type VersionHash = Uint8Array;

/**
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/beacon-chain.md#verify_kzg_commitments_against_transactions
 * No expensive verification, just checks that the version hashes are consistent with the kzg commitments
 */
export function verifyKzgCommitmentsAgainstTransactions(
  transactions: bellatrix.Transaction[],
  blobKzgCommitments: deneb.KZGCommitment[]
): boolean {
  const allVersionedHashes: VersionHash[] = [];
  for (const tx of transactions) {
    if (tx[0] === BLOB_TX_TYPE) {
      // TODO DENEB: Optimize array manipulation
      allVersionedHashes.push(...txPeekBlobVersionedHashes(tx));
    }
  }

  if (allVersionedHashes.length !== blobKzgCommitments.length) {
    throw Error(
      `allVersionedHashes len ${allVersionedHashes.length} != blobKzgCommitments len ${blobKzgCommitments.length}`
    );
  }

  for (let i = 0; i < blobKzgCommitments.length; i++) {
    const versionedHash = kzgCommitmentToVersionedHash(blobKzgCommitments[i]);
    if (!byteArrayEquals(allVersionedHashes[i], versionedHash)) {
      throw Error(`Wrong versionedHash ${i} ${toHex(allVersionedHashes[i])} != ${toHex(versionedHash)}`);
    }
  }

  // TODO DENEB: Use proper API, either throw error or return boolean
  return true;
}

function txPeekBlobVersionedHashes(opaqueTx: bellatrix.Transaction): VersionHash[] {
  if (opaqueTx[0] !== BLOB_TX_TYPE) {
    throw Error(`tx type ${opaqueTx[0]} != BLOB_TX_TYPE`);
  }

  const opaqueTxDv = new DataView(opaqueTx.buffer, opaqueTx.byteOffset, opaqueTx.byteLength);

  const blobVersionedHashesOffset =
    OPAQUE_TX_MESSAGE_OFFSET + opaqueTxDv.getUint32(OPAQUE_TX_BLOB_VERSIONED_HASHES_OFFSET, true);

  // Guard against offsets that go beyond end of bytes
  if (blobVersionedHashesOffset > opaqueTx.length) {
    throw Error(`blobVersionedHashesOffset ${blobVersionedHashesOffset} > EOF ${opaqueTx.length}`);
  }

  // Guard against not multiple of BYTES_PER_HASH
  const blobVersionedHashesByteLen = opaqueTx.length - blobVersionedHashesOffset;
  if ((opaqueTx.length - blobVersionedHashesOffset) % BYTES_PER_HASH !== 0) {
    throw Error(`Uneven blobVersionedHashesByteLen ${blobVersionedHashesByteLen}`);
  }

  const versionedHashes: VersionHash[] = [];

  // iterate from x to end of data, in steps of 32, to get all hashes
  for (let i = blobVersionedHashesOffset; i < opaqueTx.length; i += BYTES_PER_HASH) {
    versionedHashes.push(opaqueTx.subarray(i, i + BYTES_PER_HASH));
  }

  return versionedHashes;
}

export function kzgCommitmentToVersionedHash(kzgCommitment: deneb.KZGCommitment): VersionHash {
  const hash = SHA256.digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}
