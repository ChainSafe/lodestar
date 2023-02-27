import {expect} from "chai";
import {bellatrix, deneb, ssz} from "@lodestar/types";
import {BLOB_TX_TYPE, BYTES_PER_FIELD_ELEMENT} from "@lodestar/params";
import {
  kzgCommitmentToVersionedHash,
  OPAQUE_TX_BLOB_VERSIONED_HASHES_OFFSET,
  OPAQUE_TX_MESSAGE_OFFSET,
} from "@lodestar/state-transition";
import {loadEthereumTrustedSetup, initCKZG, ckzg, FIELD_ELEMENTS_PER_BLOB_MAINNET} from "../../../src/util/kzg.js";
import {validateBlobsSidecar, validateGossipBlobsSidecar} from "../../../src/chain/validation/blobsSidecar.js";

describe("C-KZG", () => {
  before(async function () {
    this.timeout(10000); // Loading trusted setup is slow
    await initCKZG();
    loadEthereumTrustedSetup();
  });

  it("computes the correct commitments and aggregate proofs from blobs", () => {
    // ====================
    // Apply this example to the test data
    // ====================
    const blobs = new Array(2).fill(0).map(generateRandomBlob);
    const commitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));
    const proof = ckzg.computeAggregateKzgProof(blobs);
    expect(ckzg.verifyAggregateKzgProof(blobs, commitments, proof)).to.equal(true);
  });

  it("BlobsSidecar", () => {
    const slot = 0;
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));

    const signedBeaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const beaconBlockRoot = ssz.deneb.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);

    const blobsSidecar: deneb.BlobsSidecar = {
      beaconBlockRoot,
      beaconBlockSlot: 0,
      blobs,
      kzgAggregatedProof: ckzg.computeAggregateKzgProof(blobs),
    };

    // Full validation
    validateBlobsSidecar(slot, beaconBlockRoot, kzgCommitments, blobsSidecar);

    // Gossip validation
    validateGossipBlobsSidecar(signedBeaconBlock, blobsSidecar);
  });
});

function transactionForKzgCommitment(kzgCommitment: deneb.KZGCommitment): bellatrix.Transaction {
  // Some random value that after the offset's position
  const blobVersionedHashesOffset = OPAQUE_TX_BLOB_VERSIONED_HASHES_OFFSET + 64;

  // +32 for the size of versionedHash
  const ab = new ArrayBuffer(blobVersionedHashesOffset + 32);
  const dv = new DataView(ab);
  const ua = new Uint8Array(ab);

  // Set tx type
  dv.setUint8(0, BLOB_TX_TYPE);

  // Set offset to hashes array
  // const blobVersionedHashesOffset =
  //   OPAQUE_TX_MESSAGE_OFFSET + opaqueTxDv.getUint32(OPAQUE_TX_BLOB_VERSIONED_HASHES_OFFSET, true);
  dv.setUint32(OPAQUE_TX_BLOB_VERSIONED_HASHES_OFFSET, blobVersionedHashesOffset - OPAQUE_TX_MESSAGE_OFFSET, true);

  const versionedHash = kzgCommitmentToVersionedHash(kzgCommitment);
  ua.set(versionedHash, blobVersionedHashesOffset);

  return ua;
}

/**
 * Generate random blob of sequential integers such that each element is < BLS_MODULUS
 */
function generateRandomBlob(): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB_MAINNET * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB_MAINNET; i++) {
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, i);
  }
  return blob;
}
