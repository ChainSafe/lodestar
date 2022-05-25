import {unshuffleList} from "@chainsafe/lodestar-beacon-state-transition";
import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {bnToNum, fromHex} from "@chainsafe/lodestar-utils";
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
    },
  };
};

type ShufflingTestCase = {
  mapping: {
    seed: string;
    count: bigint;
    mapping: bigint[];
  };
};
