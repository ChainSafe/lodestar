import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import {Blob, Cell, KZGProof} from "c-kzg";
import {fromHex} from "@lodestar/utils";

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
        blob: fromHex(blob),
        cells: cells.map(fromHex),
        proofs: proofs.map(fromHex),
      });
    }
  }
  return mocks;
}
