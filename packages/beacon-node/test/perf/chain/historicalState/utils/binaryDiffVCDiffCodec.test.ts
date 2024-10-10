import fs from "node:fs";
import path from "node:path";
import {itBench} from "@dapplion/benchmark";
import {BinaryDiffVCDiffCodec} from "../../../../../src/chain/historicalState/utils/binaryDiffVCDiffCodec.js";
import {IBinaryDiffCodec} from "../../../../../src/chain/historicalState/index.js";

describe("BinaryDiffVCDiffCodec", () => {
  let originalState: Uint8Array;
  let changedState: Uint8Array;
  let codec: IBinaryDiffCodec;
  let diff: Uint8Array;

  before(async function () {
    this.timeout(2 * 60 * 1000); // Generating the states for the first time is very slow

    codec = new BinaryDiffVCDiffCodec();
    await codec.init();

    originalState = Buffer.from(
      fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/binaryDiff/source.txt"), "utf8"),
      "hex"
    );
    changedState = Buffer.from(
      fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/binaryDiff/input.txt"), "utf8"),
      "hex"
    );
    diff = codec.compute(originalState, changedState);
  });

  itBench({
    id: "compute",
    fn: () => {
      codec.compute(originalState, changedState);
    },
  });

  itBench({
    id: "apply",
    fn: () => {
      codec.apply(originalState, diff);
    },
  });
});
