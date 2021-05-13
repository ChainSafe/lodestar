import {join} from "path";
import {config} from "@chainsafe/lodestar-config/mainnet";
import {computeShuffledIndex} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IShufflingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";

describeDirectorySpecTest<IShufflingTestCase, number[]>(
  "shuffling mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/shuffling/core/shuffle"),
  (testcase) => {
    const output: number[] = [];
    const seed = Buffer.from(testcase.mapping.seed.replace("0x", ""), "hex");
    for (let i = 0; i < Number(testcase.mapping.count); i++) {
      output[i] = computeShuffledIndex(config, i, Number(testcase.mapping.count), seed);
    }
    return output;
  },
  {
    inputTypes: {
      mapping: InputType.YAML,
    },
    timeout: 10000,
    getExpected: (testCase) => testCase.mapping.mapping.map((value) => Number(value)),
  }
);
