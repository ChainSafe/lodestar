import {join} from "path";
import {unshuffleList} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {IShufflingTestCase} from "./type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";

describeDirectorySpecTest<IShufflingTestCase, number[]>(
  "shuffling mainnet",
  join(SPEC_TEST_LOCATION, "/tests/mainnet/phase0/shuffling/core/shuffle"),
  (testcase) => {
    const seed = Buffer.from(testcase.mapping.seed.replace("0x", ""), "hex");
    const output = Array.from({length: Number(testcase.mapping.count)}, (_, i) => i);
    unshuffleList(output, seed);
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
