import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IInValidGenericSSZTestCase, parseBitListType} from "../utils";
import path from "path";
import {BitListType, deserialize, Type} from "../../../../src";
import {TEST_CASE_LOCATION} from "../../../util/testCases";

describeDirectorySpecTest<IInValidGenericSSZTestCase, void>(
  "invalid_bitlist",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/bitlist/invalid"),
  ((testCase, directoryName) => {
    const bitListType: BitListType = {
      type: Type.bitList,
      maxLength: parseBitListType(directoryName).limit.toNumber()
    };
    deserialize(
      testCase.serialized_raw,
      bitListType
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