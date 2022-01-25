import path from "node:path";
import bls from "@chainsafe/bls";
import {fromHexString} from "@chainsafe/ssz";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";

import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";

interface IAggregateSigsVerifyTestCase extends IBaseSpecTest {
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
    const {pubkeys, messages, signature} = testCase.data.input;
    return bls.verifyMultiple(pubkeys.map(fromHexString), messages.map(fromHexString), fromHexString(signature));
  },
  {
    inputTypes: {data: InputType.YAML},
    getExpected: (testCase) => testCase.data.output,
  }
);
