import path from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import bls, {initBLS} from "@chainsafe/bls";

interface AggregateSigsVerifyTestCase {
  data: {
    input: {
      pairs: [{
        pubkey: string,
        message: string
      }]
      signature: string
    },
    output: boolean;
  }
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
        const pubkeys = testCase.data.input.pairs.map(pair => {
            return Buffer.from(pair.pubkey.replace("0x", ""), "hex");
        });
        const messages = testCase.data.input.pairs.map(pair => {
            return Buffer.from(pair.message.replace("0x", ""), "hex");
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
