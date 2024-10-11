import path from "node:path";
import {unshuffleList} from "@chainsafe/swap-or-not-shuffle";
import {InputType} from "@lodestar/spec-test-util";
import {bnToNum, fromHex} from "@lodestar/utils";
import {ACTIVE_PRESET, SHUFFLE_ROUND_COUNT} from "@lodestar/params";
import {RunnerType, TestRunnerFn} from "../utils/types.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

const shuffling: TestRunnerFn<ShufflingTestCase, string> = () => {
  return {
    testFunction: (testcase) => {
      const seed = fromHex(testcase.mapping.seed);
      const output = unshuffleList(
        Uint32Array.from(Array.from({length: bnToNum(testcase.mapping.count)}, (_, i) => i)),
        seed,
        SHUFFLE_ROUND_COUNT
      );
      return Buffer.from(output).toString("hex");
    },
    options: {
      inputTypes: {mapping: InputType.YAML},
      timeout: 10000,
      getExpected: (testCase) => Buffer.from(testCase.mapping.mapping.map((value) => bnToNum(value))).toString("hex"),
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type ShufflingTestCase = {
  meta?: any;
  mapping: {
    seed: string;
    count: bigint;
    mapping: bigint[];
  };
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  shuffling: {type: RunnerType.default, fn: shuffling},
});
