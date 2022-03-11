import path from "node:path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import bls from "@chainsafe/bls";
// eslint-disable-next-line no-restricted-imports
import {ZeroSecretKeyError} from "@chainsafe/bls/lib/errors";
import {fromHexString, toHexString} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";

interface ISignMessageTestCase extends IBaseSpecTest {
  data: {
    input: {
      privkey: string;
      message: string;
    };
    output: string;
  };
}

describeDirectorySpecTest<ISignMessageTestCase, string | null>(
  "bls/sign/small",
  path.join(SPEC_TEST_LOCATION, "tests/general/phase0/bls/sign/small"),
  (testCase) => {
    try {
      const {privkey, message} = testCase.data.input;
      const signature = bls.sign(fromHexString(privkey), fromHexString(message));
      return toHexString(signature);
    } catch (e) {
      if (e instanceof ZeroSecretKeyError) return null;
      else throw e;
    }
  },
  {
    inputTypes: {data: InputType.YAML},
    getExpected: (testCase) => testCase.data.output,
  }
);
