import {itBench} from "@dapplion/benchmark";
import {toHex, toRootHex} from "../../src/bytes.js";

describe("bytes utils", function () {
  const runsFactor = 1000;
  const blockRoot = new Uint8Array(Array.from({length: 32}, (_, i) => i));

  itBench({
    id: "block root to RootHex using toHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toHex(blockRoot);
      }
    },
    runsFactor,
  });

  itBench({
    id: "block root to RootHex using toRootHex",
    fn: () => {
      for (let i = 0; i < runsFactor; i++) {
        toRootHex(blockRoot);
      }
    },
    runsFactor,
  });
});
