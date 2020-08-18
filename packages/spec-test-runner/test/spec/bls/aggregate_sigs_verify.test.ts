import path from "path";
import bls, {initBLS} from "@chainsafe/bls";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";

interface AggregateSigsVerifyTestCase {
  data: {
    input: {
      pubkeys: string[];
      messages: string[];
      signature: string;
    };
    output: boolean;
  };
}

before(async function f() {
  try {
    await initBLS();
  } catch (e) {
    console.log(e);
  }
});

describeDirectorySpecTest<AggregateSigsVerifyTestCase, boolean>(
  "BLS - aggregate sigs verify",
  path.join(
    __dirname,
    "../../../../../node_modules/@chainsafe/eth2-spec-tests/tests/general/phase0/bls/aggregate_verify/small"
  ),
  (testCase => {
    const pubkeys = testCase.data.input.pubkeys.map(pubkey => {
      return Buffer.from(pubkey.replace("0x", ""), "hex");
    });
    const messages = testCase.data.input.messages.map(message => {
      return Buffer.from(message.replace("0x", ""), "hex");
    });
    return bls.verifyMultiple(
      pubkeys,
      messages,
      Buffer.from(testCase.data.input.signature.replace("0x", ""), "hex"),
    );
  }),
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase => testCase.data.output)
  }
);
