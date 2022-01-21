import {join} from "node:path";
import {unshuffleList} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {bnToNum, fromHex} from "@chainsafe/lodestar-utils";

describeDirectorySpecTest<IShufflingTestCase, number[]>(
  `${ACTIVE_PRESET}/phase0/shuffling/`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/phase0/shuffling/core/shuffle`),
  (testcase) => {
    const seed = fromHex(testcase.mapping.seed);
    const output = Array.from({length: bnToNum(testcase.mapping.count)}, (_, i) => i);
    unshuffleList(output, seed);
    return output;
  },
  {
    inputTypes: {mapping: InputType.YAML},
    timeout: 10000,
    getExpected: (testCase) => testCase.mapping.mapping.map((value) => bnToNum(value)),
  }
);

interface IShufflingTestCase extends IBaseSpecTest {
  mapping: {
    seed: string;
    count: bigint;
    mapping: bigint[];
  };
}
