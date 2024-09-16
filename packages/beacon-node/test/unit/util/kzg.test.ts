import {describe, it, expect, afterEach, beforeAll} from "vitest";
import {bellatrix, deneb, ssz} from "@lodestar/types";
import {BYTES_PER_FIELD_ELEMENT, BLOB_TX_TYPE} from "@lodestar/params";
import {createBeaconConfig, createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {computeBlobSidecars, computeDataColumnSidecars, kzgCommitmentToVersionedHash} from "../../../src/util/blobs.js";
import {loadEthereumTrustedSetup, initCKZG, ckzg, FIELD_ELEMENTS_PER_BLOB_MAINNET} from "../../../src/util/kzg.js";
import {validateBlobSidecars, validateGossipBlobSidecar} from "../../../src/chain/validation/blobSidecar.js";
import {getBlobCellAndProofs} from "../../utils/getBlobCellAndProofs.js";

describe("C-KZG", () => {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  beforeAll(async function () {
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
    expect(ckzg.verifyBlobKzgProofBatch(blobs, commitments, proofs)).toBe(true);
  });

  /* eslint-disable @typescript-eslint/naming-convention */
  it("BlobSidecars", async () => {
    const chainConfig = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const chain = getMockedBeaconChain({config});
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
    const kzgProofs = blobs.map((blob, index) => ckzg.computeBlobKzgProof(blob, kzgCommitments[index]));
    const blobSidecars: deneb.BlobSidecars = computeBlobSidecars(chain.config, signedBeaconBlock, {blobs, kzgProofs});

    expect(blobSidecars.length).toBe(2);

    // Full validation
    validateBlobSidecars(slot, blockRoot, kzgCommitments, blobSidecars);

    blobSidecars.forEach(async (blobSidecar) => {
      try {
        await validateGossipBlobSidecar(chain, blobSidecar, blobSidecar.index);
      } catch (error) {
        // We expect some error from here
        // console.log(error);
      }
    });
  });

  it("DataColumnSidecars", () => {
    const config = createChainForkConfig({
      ...defaultChainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
    });
    const signedBeaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();
    const mocks = getBlobCellAndProofs();
    const blobs = mocks.map(({blob}) => blob);
    const kzgCommitments = blobs.map(ckzg.blobToKzgCommitment);
    for (const commitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(commitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(commitment);
    }

    const sidecars = computeDataColumnSidecars(config, signedBeaconBlock, {blobs});
    const signedBlockHeader = signedBlockToSignedHeader(config, signedBeaconBlock);

    sidecars.forEach((sidecar, column) => {
      expect(sidecar.index).toBe(column);
      expect(sidecar.signedBlockHeader).toStrictEqual(signedBlockHeader);
      expect(sidecar.kzgCommitments).toStrictEqual(kzgCommitments);
      expect(sidecar.column.length).toBe(blobs.length);
      expect(sidecar.kzgProofs.length).toBe(blobs.length);
      sidecar.column.forEach((cell, row) => {
        expect(Uint8Array.from(cell)).toStrictEqual(mocks[row].cells[column]);
        const proof = sidecar.kzgProofs[row];
        expect(Uint8Array.from(proof)).toStrictEqual(mocks[row].proofs[column]);
        const commitment = sidecar.kzgCommitments[row];
        const cellIndex = sidecar.index;
        expect(ckzg.verifyCellKzgProofBatch([commitment], [cellIndex], [cell], [proof])).toBeTruthy();
      });
      expect(
        ckzg.verifyCellKzgProofBatch(
          sidecar.kzgCommitments,
          Array.from({length: sidecar.column.length}, () => sidecar.index),
          sidecar.column,
          sidecar.kzgProofs
        )
      ).toBeTruthy();
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
