import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IInValidGenericSSZTestCase} from "../utils";
import path from "path";
import {BoolType, deserialize, Type} from "../../../../src";
import {TEST_CASE_LOCATION} from "../../../util/testCases";

describeDirectorySpecTest<IInValidGenericSSZTestCase, void>(
  "invalid_boolean",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/boolean/invalid"),
  ((testCase) => {
    const booleanType: BoolType = {
      type: Type.bool,
    };
    deserialize(
      testCase.serialized_raw,
      booleanType
    );
  }),
  {
    inputTypes: {
      // eslint-disable-next-line @typescript-eslint/camelcase,camelcase
      serialized_raw: InputType.SSZ
    },
    shouldError: () => true,
    unsafeInput: false,
  }
);