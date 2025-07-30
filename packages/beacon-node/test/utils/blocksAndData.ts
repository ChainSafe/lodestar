import {randomBytes} from "node:crypto";
import {SIGNATURE_LENGTH_UNCOMPRESSED} from "@chainsafe/blst";
import {BYTES_PER_BLOB, BYTES_PER_FIELD_ELEMENT} from "@crate-crypto/node-eth-kzg";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {fulu, ssz} from "@lodestar/types";
import {kzg} from "../../src/util/rustKzg.js";
import {ROOT_SIZE} from "../../src/util/sszBytes.js";

/**
 * Value used in c-kzg
 * https://github.com/matthewkeil/c-kzg-4844/blob/cc7c4e90669efc777a92b375574036a64f8ae9ae/bindings/node.js/test/kzg.test.ts#L42
 */
const MAX_TOP_BYTE = 114;

/**
 * Generates a random blob of the correct length for the KZG library
 * https://github.com/matthewkeil/c-kzg-4844/blob/cc7c4e90669efc777a92b375574036a64f8ae9ae/bindings/node.js/test/kzg.test.ts#L87
 */
function generateRandomBlob(): Uint8Array {
  return new Uint8Array(
    randomBytes(BYTES_PER_BLOB).map((x, i) => {
      // Set the top byte to be low enough that the field element doesn't overflow the BLS modulus
      if (x > MAX_TOP_BYTE && i % BYTES_PER_FIELD_ELEMENT === 0) {
        return Math.floor(Math.random() * MAX_TOP_BYTE);
      }
      return x;
    })
  );
}

export function generateColumnSidecars(numberOfBlobs: number): fulu.DataColumnSidecars {
  const blobs = Array.from({length: numberOfBlobs}, () => generateRandomBlob());
  const kzgCommitments = blobs.map((blob) => kzg.blobToKzgCommitment(blob));
  const cellsAndProofs = blobs.map((blob) => kzg.computeCellsAndKzgProofs(blob));
  const signedBlockHeader = ssz.fulu.SignedBeaconBlockHeader.defaultValue();
  signedBlockHeader.message.slot = 1234;
  signedBlockHeader.message.proposerIndex = 5678;
  signedBlockHeader.message.bodyRoot = randomBytes(ROOT_SIZE);
  signedBlockHeader.message.parentRoot = randomBytes(ROOT_SIZE);
  signedBlockHeader.message.stateRoot = randomBytes(ROOT_SIZE);
  signedBlockHeader.signature = randomBytes(SIGNATURE_LENGTH_UNCOMPRESSED);

  return Array.from({length: NUMBER_OF_COLUMNS}, (_, columnIndex) => {
    // columnIndex'th column
    const column = Array.from({length: blobs.length}, (_, rowNumber) => cellsAndProofs[rowNumber].cells[columnIndex]);
    const kzgProofs = Array.from(
      {length: blobs.length},
      (_, rowNumber) => cellsAndProofs[rowNumber].proofs[columnIndex]
    );
    const kzgCommitmentsInclusionProof = Array.from({length: 5}, () => randomBytes(ROOT_SIZE));
    return {
      index: columnIndex,
      column,
      kzgCommitments,
      kzgProofs,
      signedBlockHeader,
      kzgCommitmentsInclusionProof,
    };
  });
}
