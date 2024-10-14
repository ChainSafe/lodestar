import {itBench} from "@dapplion/benchmark";
import {toHex, toRootHex} from "../../src/bytes/nodejs.js";
import {toHex as browserToHex, toRootHex as browserToRootHex} from "../../src/bytes/browser.js";
import {toHexString} from "../../src/bytes.js";

describe("bytes utils", () => {
  const runsFactor = 1000;
  const blockRoot = new Uint8Array(Array.from({length: 32}, (_, i) => i));

  itBench({
    id: "nodejs block root to RootHex using toHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toHex(blockRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "nodejs block root to RootHex using toRootHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toRootHex(blockRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "browser block root to RootHex using the deprecated toHexString",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toHexString(blockRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "browser block root to RootHex using toHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserToHex(blockRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "browser block root to RootHex using toRootHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        browserToRootHex(blockRoot);
      }
    },
    runsFactor,
  });
});
