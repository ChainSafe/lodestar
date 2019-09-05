import bls from "../../src";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import path from "path";

interface AggregatePubKeysTestCase {
  data: {
    input: string[];
    output: string;
  };
}

describeDirectorySpecTest<AggregatePubKeysTestCase, string>(
  "aggregate pubkeys",
  path.join(__dirname, "../../../spec-test-cases/tests/general/phase0/bls/aggregate_pubkeys/small"),
  (testCase => {
    const result =  bls.aggregatePubkeys(testCase.data.input.map(pubKey => {
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
