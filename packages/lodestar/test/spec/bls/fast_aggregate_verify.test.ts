import path from "node:path";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import bls from "@chainsafe/bls";
import {CoordType} from "@chainsafe/bls/types";
import {fromHexString} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../specTestVersioning.js";
import {IBaseSpecTest} from "../type.js";

interface IAggregateSigsVerifyTestCase extends IBaseSpecTest {
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
    const {pubkeys, message, signature} = testCase.data.input;
    try {
      return bls.Signature.fromBytes(fromHexString(signature), undefined, true).verifyAggregate(
        pubkeys.map((hex) => bls.PublicKey.fromBytes(fromHexString(hex), CoordType.jacobian, true)),
        fromHexString(message)
      );
    } catch (e) {
      return false;
    }
  },
  {
    inputTypes: {data: InputType.YAML},
    getExpected: (testCase) => testCase.data.output,
  }
);
