import path from "path";
import bls, {initBLS} from "../../src";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";

interface AggregateSigsTestCase {
  data: {
    input: string[];
    output: string;
  };
}

before(async function f() {
  await initBLS();
});

describeDirectorySpecTest<AggregateSigsTestCase, string>(
  "aggregate sigs",
  path.join(
    __dirname,
    "../../../../node_modules/@chainsafe/eth2-spec-tests/tests/general/phase0/bls/aggregate_sigs/small"
  ),
  (testCase => {
    const result =  bls.aggregateSignatures(testCase.data.input.map(pubKey => {
      return Buffer.from(pubKey.replace("0x", ""), "hex");
    }));
    return `0x${result.toString("hex")}`;
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => testCase.data.output)
  }
);
