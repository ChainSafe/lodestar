import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {signedBlockToSignedHeader} from "@lodestar/state-transition";
import {deneb, fulu, ssz} from "@lodestar/types";
import {afterEach, describe, expect, it} from "vitest";
import {validateBlobSidecars, validateGossipBlobSidecar} from "../../../src/chain/validation/blobSidecar.js";
import {computeBlobSidecars, computeDataColumnSidecars, recoverDataColumnSidecars} from "../../../src/util/blobs.js";
import {kzg} from "../../../src/util/kzg.js";
import {shuffle} from "../../../src/util/shuffle.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getBlobCellAndProofs} from "../../utils/getBlobCellAndProofs.js";
import {generateRandomBlob, transactionForKzgCommitment} from "../../utils/kzg.js";

describe("KZG", () => {
  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("computes the correct commitments and aggregate proofs from blobs", () => {
    // ====================
    // Apply this example to the test data
    // ====================
    const blobs = new Array(2).fill(0).map(generateRandomBlob);
    const commitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const proofs = blobs.map((blob, index) => kzg.computeBlobKzgProof(blob, commitments[index]));
    expect(kzg.verifyBlobKzgProofBatch(blobs, commitments, proofs)).toBe(true);
  });

  it("BlobSidecars", async () => {
    const chainConfig = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
    });
    const genesisValidatorsRoot = Buffer.alloc(32, 0xaa);
    const config = createBeaconConfig(chainConfig, genesisValidatorsRoot);

    const chain = getMockedBeaconChain({config});
    afterEachCallbacks.push(() => chain.close());

    const slot = 0;
    const fork = config.getForkName(slot);
    const blobs = [generateRandomBlob(), generateRandomBlob()];
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));

    const signedBeaconBlock = ssz.deneb.SignedBeaconBlock.defaultValue();

    for (const kzgCommitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(kzgCommitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(kzgCommitment);
    }
    const blockRoot = ssz.deneb.BeaconBlock.hashTreeRoot(signedBeaconBlock.message);
    const kzgProofs = blobs.map((blob, index) => kzg.computeBlobKzgProof(blob, kzgCommitments[index]));
    const blobSidecars: deneb.BlobSidecars = computeBlobSidecars(chain.config, signedBeaconBlock, {blobs, kzgProofs});

    expect(blobSidecars.length).toBe(2);

    // Full validation
    await validateBlobSidecars(slot, blockRoot, kzgCommitments, blobSidecars);

    for (const blobSidecar of blobSidecars) {
      try {
        await validateGossipBlobSidecar(fork, chain, blobSidecar, blobSidecar.index);
      } catch (_e) {
        // We expect some error from here
        // console.log(error);
      }
    }
  });

  it("DataColumnSidecars", async () => {
    const config = createChainForkConfig({
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    });
    const signedBeaconBlock = ssz.fulu.SignedBeaconBlock.defaultValue();
    const mocks = getBlobCellAndProofs();
    const blobs = mocks.map(({blob}) => blob);
    console.log(blobs);
    const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
    const kzgProofs = blobs.flatMap((blob) => kzg.computeCellsAndKzgProofs(blob).proofs);
    for (const commitment of kzgCommitments) {
      signedBeaconBlock.message.body.executionPayload.transactions.push(transactionForKzgCommitment(commitment));
      signedBeaconBlock.message.body.blobKzgCommitments.push(commitment);
    }

    const sidecars = computeDataColumnSidecars(config, signedBeaconBlock, {blobs, kzgProofs});
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
        expect(kzg.verifyCellKzgProofBatch([commitment], [BigInt(cellIndex)], [cell], [proof])).toBeTruthy();
      });
      expect(
        kzg.verifyCellKzgProofBatch(
          sidecar.kzgCommitments,
          Array.from({length: sidecar.column.length}, () => BigInt(sidecar.index)),
          sidecar.column,
          sidecar.kzgProofs
        )
      ).toBeTruthy();
    });

    const partialSidecars = new Map<number, fulu.DataColumnSidecar>();
    for (let i = 0; i < NUMBER_OF_COLUMNS; i++) {
      if (i % 2 === 0) {
        // skip every second column to simulate partial sidecars
        continue;
      }
      partialSidecars.set(i, sidecars[i]);
    }
    const shuffled = shuffle(Array.from(partialSidecars.keys()));
    const shuffledPartial = new Map<number, fulu.DataColumnSidecar>();
    for (const columnIndex of shuffled) {
      const sidecar = partialSidecars.get(columnIndex);
      if (sidecar) {
        shuffledPartial.set(columnIndex, sidecar);
      }
    }

    const recoveredSidecars = await recoverDataColumnSidecars(shuffledPartial);
    expect(recoveredSidecars !== null).toBeTruthy();
    if (recoveredSidecars == null) {
      // should not happen
      throw new Error("Recovered sidecars should not be null");
    }
    expect(recoveredSidecars.length).toBe(NUMBER_OF_COLUMNS);
    expect(ssz.fulu.DataColumnSidecars.equals(recoveredSidecars, sidecars)).toBeTruthy();
  });
});
