import {unshuffleList} from "@lodestar/state-transition";
import {InputType} from "@lodestar/spec-test-util";
import {bnToNum, fromHex} from "@lodestar/utils";
import {TestRunnerFn} from "../utils/types.js";

export const shuffling: TestRunnerFn<ShufflingTestCase, number[]> = () => {
  return {
    testFunction: (testcase) => {
      const seed = fromHex(testcase.mapping.seed);
      const output = Array.from({length: bnToNum(testcase.mapping.count)}, (_, i) => i);
      unshuffleList(output, seed);
      return output;
    },
    options: {
      inputTypes: {mapping: InputType.YAML},
      timeout: 10000,
      getExpected: (testCase) => testCase.mapping.mapping.map((value) => bnToNum(value)),
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
