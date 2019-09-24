import path from "path";
import bls from "../../src";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";

interface AggregateSigsTestCase {
  data: {
    input: string[];
    output: string;
  };
}

describeDirectorySpecTest<AggregateSigsTestCase, string>(
  "aggregate sigs",
  path.join(__dirname, "../../../spec-test-cases/tests/general/phase0/bls/aggregate_sigs/small"),
  (testCase => {
    const result =  bls.aggregateSignatures(testCase.data.input.map(pubKey => {
      return Buffer.from(pubKey.replace("0x", ""), "hex");
    }));
    return `0x${result.toString('hex')}`;
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => testCase.data.output)
  }
);
