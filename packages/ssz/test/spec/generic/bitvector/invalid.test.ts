import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IInValidGenericSSZTestCase, parseBitListType} from "../utils";
import path from "path";
import {deserialize, Type} from "../../../../src";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {BitVectorType} from "@chainsafe/ssz-type-schema";

describeDirectorySpecTest<IInValidGenericSSZTestCase, void>(
  "invalid_bitvector",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/bitvector/invalid"),
  ((testCase, directoryName) => {
    const bitVectorType: BitVectorType = {
      type: Type.bitVector,
      length: parseBitListType(directoryName).limit.toNumber()
    };
    deserialize(
      testCase.serialized_raw,
      bitVectorType
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