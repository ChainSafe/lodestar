import {bench, describe} from "@chainsafe/benchmark";
import {toHexString} from "../../src/bytes.js";
import {
  fromHex as browserFromHex,
  fromHexInto as browserFromHexInto,
  toHex as browserToHex,
  toRootHex as browserToRootHex,
} from "../../src/bytes/browser.js";
import {fromHex, toHex, toRootHex} from "../../src/bytes/nodejs.js";

describe("bytes utils", () => {
  const runsFactor = 1000;
  const blockRoot = new Uint8Array(Array.from({length: 32}, (_, i) => i));
  // FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT = 4096 * 32 = 131072
  const BLOB_LEN = 131072;
  const blob = new Uint8Array(BLOB_LEN);
  for (let i = 0; i < blob.length; i++) {
    blob[i] = i % 256;
  }
  const blobHex = toHex(blob);

  bench({
    id: "nodejs block root to RootHex using toHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toHex(blockRoot);
      }
    },
    runsFactor,
  });

  bench({
    id: "nodejs block root to RootHex using toRootHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toRootHex(blockRoot);
      }
    },
    runsFactor,
  });

  bench({
    id: "nodejs fromhex(blob)",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        fromHex(blobHex);
      }
    },
  });

  const buffer = Buffer.alloc(BLOB_LEN);
  bench({
    id: "nodejs fromHexInto(blob)",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        nodeJsFromHexInto(blobHex, buffer);
      }
    },
  });

  bench({
    id: "browser block root to RootHex using the deprecated toHexString",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toHexString(blockRoot);
      }
    },
    runsFactor,
  });

  bench({
    id: "browser block root to RootHex using toHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserToHex(blockRoot);
      }
    },
    runsFactor,
  });

  bench({
    id: "browser block root to RootHex using toRootHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserToRootHex(blockRoot);
      }
    },
    runsFactor,
  });

  const buf = new Uint8Array(BLOB_LEN);
  bench({
    id: "browser fromHexInto(blob)",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserFromHexInto(blobHex, buf);
      }
    },
    runsFactor,
  });

  bench({
    id: "browser fromHex(blob)",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserFromHex(blobHex);
      }
    },
  });
});

/**
 * this function is so slow compared to browser's implementation we only maintain it here to compare performance
 *   - nodejs fromHexInto(blob)                                            3.562495 ops/s    280.7022 ms/op        -         10 runs   3.50 s
 *   - browser fromHexInto(blob)                                           535.0952 ops/s    1.868826 ms/op        -         10 runs   20.8 s
 */
function nodeJsFromHexInto(hex: string, buffer: Buffer): void {
  if (hex.startsWith("0x")) {
    hex = hex.slice(2);
  }

  if (hex.length !== buffer.length * 2) {
    throw new Error(`hex string length ${hex.length} must be exactly double the buffer length ${buffer.length}`);
  }

  buffer.write(hex, "hex");
}
