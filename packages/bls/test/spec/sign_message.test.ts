import path from "path";
import bls from "../../src";
import {padLeft} from "../../src/helpers/utils";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";

interface SignMessageTestCase {
  data: {
    input: {
      privkey: string;
      message: string;
      domain: string;
    };
    output: string;
  };
}

describeDirectorySpecTest<SignMessageTestCase, string>(
  "priv_to_pub",
  path.join(__dirname, "../../../spec-test-cases/tests/general/phase0/bls/sign_msg/small"),
  (testCase => {
    const signature =  bls.sign(
      Buffer.from(testCase.data.input.privkey.replace("0x", ""), "hex"),
      Buffer.from(testCase.data.input.message.replace("0x", ""), "hex"),
      padLeft(Buffer.from(testCase.data.input.domain.replace('0x', ''), 'hex'), 8)
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