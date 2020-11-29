import path from "path";
import bls from "@chainsafe/bls";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";

import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";

interface IAggregateSigsVerifyTestCase {
  data: {
    input: {
      pubkeys: string[];
      messages: string[];
      signature: string;
    };
    output: boolean;
  };
}

describeDirectorySpecTest<IAggregateSigsVerifyTestCase, boolean>(
  "bls/aggregate_verify/small",
  path.join(SPEC_TEST_LOCATION, "tests/general/phase0/bls/aggregate_verify/small"),
  (testCase) => {
    const pubkeys = testCase.data.input.pubkeys.map((pubkey) => {
      return Buffer.from(pubkey.replace("0x", ""), "hex");
    });
    const messages = testCase.data.input.messages.map((message) => {
      return Buffer.from(message.replace("0x", ""), "hex");
    });
    return bls.verifyMultiple(pubkeys, messages, Buffer.from(testCase.data.input.signature.replace("0x", ""), "hex"));
  },
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase) => testCase.data.output,
    // Temporally disabled until @chainsafe/bls update
    shouldSkip: (_, name) => name === "aggregate_verify_infinity_pubkey",
  }
);
