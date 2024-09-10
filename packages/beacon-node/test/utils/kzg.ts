import {bellatrix, deneb} from "@lodestar/types";
import {BLOB_TX_TYPE, BYTES_PER_FIELD_ELEMENT} from "@lodestar/params";
import {kzgCommitmentToVersionedHash} from "../../src/util/blobs.js";
import {FIELD_ELEMENTS_PER_BLOB_MAINNET} from "../../src/util/kzg.js";

export function transactionForKzgCommitment(kzgCommitment: deneb.KZGCommitment): bellatrix.Transaction {
  // Just use versionedHash as the transaction encoding to mock newPayloadV3 verification
  // prefixed with BLOB_TX_TYPE
  const transaction = new Uint8Array(33);
  const versionedHash = kzgCommitmentToVersionedHash(kzgCommitment);
  transaction[0] = BLOB_TX_TYPE;
  transaction.set(versionedHash, 1);
  return transaction;
}

/**
 * Generate random blob of sequential integers such that each element is < BLS_MODULUS
 */
export function generateRandomBlob(): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB_MAINNET * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB_MAINNET; i++) {
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, i);
  }
  return blob;
}
