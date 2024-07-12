import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";

import {Blob, Cell, KZGProof} from "c-kzg";

interface BlobCellAndProofMock {
  blob: Blob;
  cells: Cell[];
  proofs: KZGProof[];
}

interface BlobCellAndProofYamlFormat {
  input: {
    blob: string;
  };
  //output: [Cell[], KZGProof[]]
  output: [string[], string[]];
}

function bytesFromHex(hexString: string): Uint8Array {
  if (hexString.startsWith("0x")) {
    hexString = hexString.slice(2);
  }
  return Uint8Array.from(Buffer.from(hexString, "hex"));
}

export function getBlobCellAndProofs(): BlobCellAndProofMock[] {
  const mocks = [] as BlobCellAndProofMock[];
  const mocksDir = path.resolve(__dirname, "..", "fixtures", "blobsAndCells");
  for (const file of fs.readdirSync(mocksDir)) {
    const filepath = path.resolve(mocksDir, file);
    if (fs.statSync(filepath).isFile()) {
      const {
        input: {blob},
        output: [cells, proofs],
      } = yaml.load(fs.readFileSync(filepath, "utf-8")) as BlobCellAndProofYamlFormat;
      mocks.push({
        blob: bytesFromHex(blob),
        cells: cells.map(bytesFromHex),
        proofs: proofs.map(bytesFromHex),
      });
    }
  }
  return mocks;
}
