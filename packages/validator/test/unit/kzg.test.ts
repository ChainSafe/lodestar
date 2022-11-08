import {randomBytes} from "node:crypto";
import {expect} from "chai";
import {
  loadTrustedSetup,
  freeTrustedSetup,
  blobToKzgCommitment,
  computeAggregateKzgProof,
  verifyAggregateKzgProof,
  BYTES_PER_FIELD_ELEMENT,
  FIELD_ELEMENTS_PER_BLOB,
} from "c-kzg";

const SETUP_FILE_PATH = "../../../../trusted_setup.txt";
const BLOB_BYTE_COUNT = FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT;

const generateRandomBlob = (): Uint8Array => new Uint8Array(randomBytes(BLOB_BYTE_COUNT));

describe("C-KZG", () => {
  before(function () {
    this.timeout(10000); // Loading trusted setup is slow
    loadTrustedSetup(SETUP_FILE_PATH);
  });

  after(() => {
    freeTrustedSetup();
  });

  it("computes the correct commitments and aggregate proofs from blobs", () => {
    const blobs = new Array(2).fill(0).map(generateRandomBlob);
    const commitments = blobs.map(blobToKzgCommitment);
    const proof = computeAggregateKzgProof(blobs);
    expect(verifyAggregateKzgProof(blobs, commitments, proof)).to.equal(true);
  });
});
