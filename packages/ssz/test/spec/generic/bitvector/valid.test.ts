import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IValidGenericSSZTestCase, IValidTestResult, parseBitListType} from "../utils";
import path from "path";
import {deserialize, equals, hashTreeRoot, serialize, signingRoot, Type} from "../../../../src";
import {expect} from "chai";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {fromYaml} from "@chainsafe/eth2.0-utils";
import {BitVectorType} from "@chainsafe/ssz-type-schema";

describeDirectorySpecTest<IValidGenericSSZTestCase, IValidTestResult>(
  "valid_bitvector",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/bitvector/valid"),
  ((testCase, directoryName) => {
    const bitVectorType: BitVectorType = {
      type: Type.bitVector,
      length: parseBitListType(directoryName).limit.toNumber()
    };
    return {
      decoded: deserialize(
        testCase.serialized_raw,
        bitVectorType
      ),
      encoded: serialize(
        testCase.value,
        bitVectorType
      ),
      root: hashTreeRoot(
        testCase.value,
        bitVectorType
      ),
      signingRoot: !testCase.meta.signingRoot ?
        null :
      // @ts-ignore
        signingRoot(testCase.value, bitVectorType),
    };
  }),
  {
    inputTypes: {
      meta: InputType.YAML,
      value: InputType.YAML,
      // eslint-disable-next-line camelcase,@typescript-eslint/camelcase
      serialized_raw: InputType.SSZ
    },
    inputProcessing: {
      value: (value: any, directoryName: string) => {
        const bitVectorType: BitVectorType = {
          type: Type.bitVector,
          length: parseBitListType(directoryName).limit.toNumber()
        };
        return fromYaml(
          value,
          bitVectorType
        );
      }
    },
    expectFunc:
        (testCase: IValidGenericSSZTestCase, expected: any, actual: IValidTestResult, directoryName: string) => {
          const bitVectorType: BitVectorType = {
            type: Type.bitVector,
            length: parseBitListType(directoryName).limit.toNumber()
          };
          expect(
            equals(
              actual.decoded,
              testCase.value,
              bitVectorType
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