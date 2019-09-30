import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IInValidGenericSSZTestCase, parseBitVectorType} from "../utils";
import path from "path";
import {deserialize, Type} from "../../../../src";
import {TEST_CASE_LOCATION} from "../../../util/testCases";

describeDirectorySpecTest<IInValidGenericSSZTestCase, void>(
  "invalid_basic_vector",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/basic_vector/invalid"),
  ((testCase, directoryName) => {
    const bitVectorType = parseBitVectorType(directoryName);
    deserialize(
      testCase.serialized_raw,
      {type: Type.vector, elementType: bitVectorType.type, length: bitVectorType.length.toNumber()}
    );
  }),
  {
    inputTypes: {
      // eslint-disable-next-line camelcase,@typescript-eslint/camelcase
      serialized_raw: InputType.SSZ
    },
    shouldError: () => true,
    unsafeInput: false,
  }
);