import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IInValidGenericSSZTestCase, parseUintType} from "../utils";
import path from "path";
import {deserialize, Type} from "../../../../src";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {UintType} from "@chainsafe/ssz-type-schema";

describeDirectorySpecTest<IInValidGenericSSZTestCase, void>(
  "invalid_uint",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/uints/invalid"),
  ((testCase, directoryName) => {
    const typeDetails = parseUintType(directoryName);
    const uintType: UintType = {
      type: Type.uint,
      useNumber: typeDetails.size < 53,
      byteLength: typeDetails.size
    };
    deserialize(
      testCase.serialized_raw,
      uintType
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