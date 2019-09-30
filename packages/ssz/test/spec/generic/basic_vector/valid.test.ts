/* eslint-disable */
import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IValidGenericSSZTestCase, parseBasicVectorType, IValidTestResult} from "../utils";
import path from "path";
import {deserialize, hashTreeRoot, serialize, signingRoot, equals, Type} from "../../../../src";
import {expect} from "chai";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {fromYaml} from "@chainsafe/eth2.0-utils";

describeDirectorySpecTest<IValidGenericSSZTestCase, IValidTestResult>(
  "valid_basic_vector",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/basic_vector/valid"),
  ((testCase, directoryName) => {
    const bitVectorType = parseBasicVectorType(directoryName);
    return {
      decoded: deserialize(
        testCase.serialized_raw,
        {type: Type.vector, elementType: bitVectorType.type, length: bitVectorType.length.toNumber()}
      ),
      encoded: serialize(
        testCase.value,
        {type: Type.vector, elementType: bitVectorType.type, length: bitVectorType.length.toNumber()}
      ),
      root: hashTreeRoot(
        testCase.value,
        {type: Type.vector, elementType: bitVectorType.type, length: bitVectorType.length.toNumber()}
      ),
      signingRoot: !testCase.meta.signingRoot ?
        null :
      // @ts-ignore
        signingRoot(testCase.value, {elementType: bitVectorType.type, length: bitVectorType.length}),
    };
  }),
  {
    inputTypes: {
      meta: InputType.YAML,
      value: InputType.YAML,
      serialized_raw: InputType.SSZ
    },
    inputProcessing: {
      value: (value: any, directoryName: string) => {
        const bitVectorType = parseBasicVectorType(directoryName);
        return fromYaml(
            value,
            {type: Type.vector, elementType: bitVectorType.type, length: bitVectorType.length.toNumber()}
            );
      }
    },
    expectFunc: (testCase: IValidGenericSSZTestCase, expected: any, actual: IValidTestResult, directoryName: string) => {
      const bitVectorType = parseBasicVectorType(directoryName);
      expect(
        equals(
          actual.decoded,
          testCase.value,
          {type: Type.vector, elementType: bitVectorType.type, length: bitVectorType.length.toNumber()}
        )
      ).to.be.true;
      expect(actual.encoded).to.be.deep.equal(testCase.serialized_raw);
      expect(actual.root)
          .to.be.deep.equal(Buffer.from(testCase.meta.root.replace("0x", ""), "hex"));
      if(testCase.meta.signingRoot) {
        expect(actual.signingRoot)
            .to.be.deep.equal(
                Buffer.from(
                    testCase.meta.signingRoot.replace("0x", ""),
                    "hex"
                )
        );
      }
    },
    unsafeInput: false,
  }
);