import {expect} from "chai";
import {bellatrix, deneb, ssz} from "@lodestar/types";
import {BYTES_PER_FIELD_ELEMENT, BLOB_TX_TYPE} from "@lodestar/params";
import {kzgCommitmentToVersionedHash} from "@lodestar/state-transition";
import {loadEthereumTrustedSetup, initCKZG, ckzg, FIELD_ELEMENTS_PER_BLOB_MAINNET} from "../../../src/util/kzg.js";

import {validateBlobSidecars, validateGossipBlobSidecar} from "../../../src/chain/validation/blobSidecar.js";
import {getMockBeaconChain} from "../../utils/mocks/chain.js";

describe("C-KZG", async () => {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

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
    const proofs = blobs.map((blob, index) => ckzg.computeBlobKzgProof(blob, commitments[index]));
    expect(ckzg.verifyBlobKzgProofBatch(blobs, commitments, proofs)).to.equal(true);
  });

  it("BlobSidecars", async () => {
    const chain = getMockBeaconChain();
    afterEachCallbacks.push(() => chain.close());

    const slot = 0;
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => ckzg.blobToKzgCommitment(blob));

    const signedBeaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();

    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const blockRoot = ssz.deneb.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);

    const blobSidecars: deneb.BlobSidecars = blobs.map((blob, index) => {
      return {
        blockRoot,
        index,
        slot,
        blob,
        kzgProof: ckzg.computeBlobKzgProof(blob, kzgCommitments[index]),
        kzgCommitment: kzgCommitments[index],
        blockParentRoot: Buffer.alloc(32),
        proposerIndex: 0,
      };
    });

    const signedBlobSidecars: deneb.SignedBlobSidecar[] = blobSidecars.map((blobSidecar) => {
      const signedBlobSidecar = ssz.deneb.SignedBlobSidecar.defaultValue();
      signedBlobSidecar.message = blobSidecar;
      return signedBlobSidecar;
    });

    expect(signedBlobSidecars.length).to.equal(2);

    // Full validation
    validateBlobSidecars(slot, blockRoot, kzgCommitments, blobSidecars);

    signedBlobSidecars.forEach(async (signedBlobSidecar) => {
      await validateGossipBlobSidecar(chain.config, chain, signedBlobSidecar, signedBlobSidecar.message.index);
    });
  });
});

function transactionForKzgCommitment(kzgCommitment: deneb.KZGCommitment): bellatrix.Transaction {
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
function generateRandomBlob(): deneb.Blob {
  const blob = new Uint8Array(FIELD_ELEMENTS_PER_BLOB_MAINNET * BYTES_PER_FIELD_ELEMENT);
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let i = 0; i < FIELD_ELEMENTS_PER_BLOB_MAINNET; i++) {
    dv.setUint32(i * BYTES_PER_FIELD_ELEMENT, i);
  }
  return blob;
}
