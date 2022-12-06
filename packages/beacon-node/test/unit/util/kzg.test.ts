import crypto from "node:crypto";
import {expect} from "chai";
import {
  freeTrustedSetup,
  blobToKzgCommitment,
  computeAggregateKzgProof,
  verifyAggregateKzgProof,
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
} from "c-kzg";
import {eip4844} from "@lodestar/types";
import {loadEthereumTrustedSetup} from "../../../src/util/kzg.js";

const BLOB_BYTE_COUNT = FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT;

describe("C-KZG", () => {
  before(async function () {
    this.timeout(10000); // Loading trusted setup is slow
    loadEthereumTrustedSetup();
  });

  after(() => {
    freeTrustedSetup();
  });

  it("computes the correct commitments and aggregate proofs from blobs", () => {
    // ====================
    // Apply this example to the test data
    // ====================
    const blobs = new Array(2).fill(0).map(generateRandomBlob);
    const commitments = blobs.map(blobToKzgCommitment);
    const proof = computeAggregateKzgProof(blobs);
    expect(verifyAggregateKzgProof(blobs, commitments, proof)).to.equal(true);
  });
});

/**
 * Generate random blob of sequential integers such that each element is < BLS_MODULUS
 */
function generateRandomBlob(): eip4844.Blob {
  return new Uint8Array(crypto.randomBytes(BLOB_BYTE_COUNT));
}
