import {bench, describe} from "@chainsafe/benchmark";
import {toHexString} from "../../src/bytes.js";
import {
  fromHex as browserFromHex,
  fromHexInto as browserFromHexInto,
  toHex as browserToHex,
  toRootHex as browserToRootHex,
} from "../../src/bytes/browser.js";
import {fromHex, fromHexInto, toHex, toRootHex} from "../../src/bytes/nodejs.js";

describe("bytes utils", () => {
  const runsFactor = 1000;
  const blockRoot = new Uint8Array(Array.from({length: 32}, (_, i) => i));
  // FIELD_ELEMENTS_PER_BLOB * BYTES_PER_FIELD_ELEMENT = 4096 * 32 = 131072
  const BLOB_LEN = 131072;
  const blob = new Uint8Array(BLOB_LEN);
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
        fromHexInto(blobHex, buffer);
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
