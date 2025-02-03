import fs from "node:fs";
import path from "node:path";
import {beforeAll, bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {IBinaryDiffCodec} from "../../../../../src/chain/historicalState/index.js";
import {BinaryDiffXDelta3Codec} from "../../../../../src/chain/historicalState/utils/binaryDiffXDelta3Codec.js";

describe("BinaryDiffVCDiffCodec", () => {
  let originalState: Uint8Array;
  let changedState: Uint8Array;
  let codec: IBinaryDiffCodec;
  let diff: Uint8Array;

  setBenchOpts({timeoutBench: 2 * 60 * 1000});

  beforeAll(async () => {
    codec = new BinaryDiffXDelta3Codec();
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

  bench({
    id: "compute",
    fn: () => {
      codec.compute(originalState, changedState);
    },
  });

  bench({
    id: "apply",
    fn: () => {
      codec.apply(originalState, diff);
    },
  });
});
