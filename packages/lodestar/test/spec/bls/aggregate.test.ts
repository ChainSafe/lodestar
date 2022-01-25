import path from "node:path";
import bls from "@chainsafe/bls";
// eslint-disable-next-line no-restricted-imports
import {EmptyAggregateError} from "@chainsafe/bls/lib/errors";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";

import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";

interface IAggregateSigsTestCase extends IBaseSpecTest {
  data: {
    input: string[];
    output: string;
  };
}

describeDirectorySpecTest<IAggregateSigsTestCase, string | null>(
  "bls/aggregate/small",
  path.join(SPEC_TEST_LOCATION, "tests/general/phase0/bls/aggregate/small"),
  (testCase) => {
    try {
      const signatures = testCase.data.input;
      const agg = bls.aggregateSignatures(signatures.map(fromHexString));
      return toHexString(agg);
    } catch (e) {
      if (e instanceof EmptyAggregateError) return null;
      throw e;
    }
  },
  {
    inputTypes: {data: InputType.YAML},
    getExpected: (testCase) => testCase.data.output,
  }
);
