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
  const rootHex = toRootHex(blockRoot);

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
    id: "nodejs fromhex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        fromHex(rootHex);
      }
    },
  });

  const buffer = Buffer.alloc(32);
  bench({
    id: "nodejs fromHexInto",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        fromHexInto(rootHex, buffer);
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

  const buf = new Uint8Array(32);
  bench({
    id: "browser fromHexInto",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserFromHexInto(rootHex, buf);
      }
    },
    runsFactor,
  });

  bench({
    id: "browser fromHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserFromHex(rootHex);
      }
    },
  });
});
