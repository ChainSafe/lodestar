import SHA256 from "@chainsafe/as-sha256";
import {byteArrayEquals} from "@chainsafe/ssz";
import {bellatrix, eip4844} from "@lodestar/types";
import {toHex} from "@lodestar/utils";

// TODO EIP-4844: Move to params
const BLOB_TX_TYPE = 0x05;
const VERSIONED_HASH_VERSION_KZG = 0x01;

type VersionHash = Uint8Array;

/**
 * https://github.com/ethereum/consensus-specs/blob/11a037fd9227e29ee809c9397b09f8cc3383a8c0/specs/eip4844/beacon-chain.md#verify_kzg_commitments_against_transactions
 * No expensive verification, just checks that the version hashes are consistent with the kzg commitments
 */
export function verifyKzgCommitmentsAgainstTransactions(
  transactions: bellatrix.Transaction[],
  blobKzgCommitments: eip4844.KZGCommitment[]
): boolean {
  const allVersionedHashes: VersionHash[] = [];
  for (const tx of transactions) {
    if (tx[0] === BLOB_TX_TYPE) {
      // TODO EIP-4844: Optimize array manipulation
      allVersionedHashes.push(...txPeekBlobVersionedHashes(tx));
    }
  }

  for (let i = 0; i < blobKzgCommitments.length; i++) {
    const versionedHash = kzgCommitmentToVersionedHash(blobKzgCommitments[i]);
    if (!byteArrayEquals(allVersionedHashes[i], versionedHash)) {
      throw Error(`Wrong versionedHash ${i} ${toHex(allVersionedHashes[i])} != ${toHex(versionedHash)}`);
    }
  }

  // TODO EIP-4844: Use proper API, either throw error or return boolean
  return true;
}

function txPeekBlobVersionedHashes(opaqueTx: bellatrix.Transaction): VersionHash[] {
  if (opaqueTx[0] !== BLOB_TX_TYPE) {
    throw Error(`tx type ${opaqueTx[0]} != BLOB_TX_TYPE`);
  }

  const opaqueTxDv = new DataView(opaqueTx.buffer, opaqueTx.byteOffset, opaqueTx.byteLength);

  // uint32.decode_bytes(opaque_tx[1:5]), Should always be 70
  // true = little endian
  const messageOffset = 1 + opaqueTxDv.getUint32(1, true);
  // field offset: 32 + 8 + 32 + 32 + 8 + 4 + 32 + 4 + 4 + 32 = 188
  // Reference: https://gist.github.com/protolambda/23bd106b66f6d4bb854ce46044aa3ca3
  const blobVersionedHashesOffset = messageOffset + opaqueTxDv.getUint32(188);

  const versionedHashes: VersionHash[] = [];

  // iterate from x to end of data, in steps of 32, to get all hashes
  for (let i = blobVersionedHashesOffset; i < opaqueTx.length; i += 32) {
    versionedHashes.push(opaqueTx.subarray(i, i + 32));
  }

  return versionedHashes;
}

function kzgCommitmentToVersionedHash(kzgCommitment: eip4844.KZGCommitment): VersionHash {
  const hash = SHA256.digest(kzgCommitment);
  // Equivalent to `VERSIONED_HASH_VERSION_KZG + hash(kzg_commitment)[1:]`
  hash[0] = VERSIONED_HASH_VERSION_KZG;
  return hash;
}
