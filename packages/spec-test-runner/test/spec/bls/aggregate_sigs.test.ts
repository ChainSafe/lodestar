import path from "path";
import bls, {initBLS} from "@chainsafe/bls";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";

interface IAggregateSigsTestCase {
  data: {
    input: string[];
    output: string;
  };
}

before(async function f() {
  await initBLS();
});

describeDirectorySpecTest<IAggregateSigsTestCase, string>(
  "BLS - aggregate sigs",
  path.join(
    __dirname,
    "../../../../../node_modules/@chainsafe/eth2-spec-tests/tests/general/phase0/bls/aggregate/small"
  ),
  (testCase => {
    try {
      const result = bls.aggregateSignatures(testCase.data.input.map(pubKey => {
        return Buffer.from(pubKey.replace("0x", ""), "hex");
      }));
      return `0x${Buffer.from(result).toString("hex")}`;
    } catch (e) {
      if(e.message === "signatures is null or undefined or empty array") {
        return null;
      }
      throw e;
    }
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => testCase.data.output)
  }
);
