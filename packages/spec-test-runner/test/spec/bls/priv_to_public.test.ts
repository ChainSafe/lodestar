import path from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib/single";
import bls, {initBLS} from "@chainsafe/bls";

interface IPrivToPubTestCase {
  data: {
    input: string;
    output: string;
  };
}

before(async function f() {
  await initBLS();
});

describeDirectorySpecTest<IPrivToPubTestCase, string>(
  "BLS - priv_to_pub",
  path.join(
    __dirname,
    "../../../../../node_modules/@chainsafe/eth2-spec-tests/tests/general/phase0/bls/priv_to_pub/small"
  ),
  (testCase => {
    const result =  bls.generatePublicKey(Buffer.from(testCase.data.input.replace("0x", ""), "hex"));
    return `0x${Buffer.from(result).toString("hex")}`;
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => testCase.data.output)
  }
);
