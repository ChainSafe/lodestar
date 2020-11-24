import path from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";
import bls, {initBLS} from "@chainsafe/bls";

import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";

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
  path.join(SPEC_TEST_LOCATION, "tests/general/phase0/bls/sign/small"),
  (testCase) => {
    const signature = bls.sign(
      Buffer.from(testCase.data.input.privkey.replace("0x", ""), "hex"),
      Buffer.from(testCase.data.input.message.replace("0x", ""), "hex")
    );
    return `0x${Buffer.from(signature).toString("hex")}`;
  },
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase) => testCase.data.output,
  }
);
