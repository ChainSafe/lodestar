import path from "node:path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util/lib";
import bls from "@chainsafe/bls";
import {fromHexString} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";

interface IVerifyTestCase extends IBaseSpecTest {
  data: {
    input: {
      pubkey: string;
      message: string;
      signature: string;
    };
    output: boolean;
  };
}

describeDirectorySpecTest<IVerifyTestCase, boolean>(
  "bls/verify/small",
  path.join(SPEC_TEST_LOCATION, "tests/general/phase0/bls/verify/small"),
  (testCase) => {
    const {pubkey, message, signature} = testCase.data.input;
    return bls.verify(fromHexString(pubkey), fromHexString(message), fromHexString(signature));
  },
  {
    inputTypes: {data: InputType.YAML},
    getExpected: (testCase) => testCase.data.output,
  }
);
