import path from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import bls, {initBLS} from "@chainsafe/bls";
import {padLeft} from "@chainsafe/bls/lib/helpers/utils";

interface ISignMessageTestCase {
  data: {
    input: {
      privkey: string;
      message: string;
    };
    output: string;
  };
}

before(async function f() {
  await initBLS();
});

describeDirectorySpecTest<ISignMessageTestCase, string>(
  "BLS - sign",
  path.join(
    __dirname,
    "../../../../../node_modules/@chainsafe/eth2-spec-tests/tests/general/phase0/bls/sign/small"
  ),
  (testCase => {
    const signature =  bls.sign(
      Buffer.from(testCase.data.input.privkey.replace("0x", ""), "hex"),
      Buffer.from(testCase.data.input.message.replace("0x", ""), "hex")
    );
    return `0x${signature.toString("hex")}`;
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => testCase.data.output)
  }
);
