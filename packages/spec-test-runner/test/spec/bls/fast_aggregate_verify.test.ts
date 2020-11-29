import path from "path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";
import bls from "@chainsafe/bls";

import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";

interface IAggregateSigsVerifyTestCase {
  data: {
    input: {
      pubkeys: string[];
      message: string;
      signature: string;
    };
    output: boolean;
  };
}

describeDirectorySpecTest<IAggregateSigsVerifyTestCase, boolean>(
  "bls/fast_aggregate_verify/small",
  path.join(SPEC_TEST_LOCATION, "tests/general/phase0/bls/fast_aggregate_verify/small"),
  (testCase) => {
    return bls.verifyAggregate(
      testCase.data.input.pubkeys.map((key) => Buffer.from(key.replace("0x", ""), "hex")),
      Buffer.from(testCase.data.input.message.replace("0x", ""), "hex"),
      Buffer.from(testCase.data.input.signature.replace("0x", ""), "hex")
    );
  },
  {
    inputTypes: {
      data: InputType.YAML,
    },
    getExpected: (testCase) => testCase.data.output,
    // Temporally disabled until @chainsafe/bls update
    shouldSkip: (_, name) => name === "fast_aggregate_verify_infinity_pubkey",
  }
);
