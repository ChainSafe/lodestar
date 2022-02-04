import {join} from "node:path";
import {unshuffleList} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {Uint64} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";

describeDirectorySpecTest<IShufflingTestCase, number[]>(
  `${ACTIVE_PRESET}/phase0/shuffling/`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/phase0/shuffling/core/shuffle`),
  (testcase) => {
    const seed = Buffer.from(testcase.mapping.seed.replace("0x", ""), "hex");
    const output = Array.from({length: Number(testcase.mapping.count)}, (_, i) => i);
    unshuffleList(output, seed);
    return output;
  },
  {
    inputTypes: {mapping: InputType.YAML},
    timeout: 10000,
    getExpected: (testCase) => testCase.mapping.mapping.map((value) => Number(value)),
  }
);

interface IShufflingTestCase extends IBaseSpecTest {
  mapping: {
    seed: string;
    count: Uint64;
    mapping: Uint64[];
  };
}
