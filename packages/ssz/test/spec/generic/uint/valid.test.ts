import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IValidGenericSSZTestCase, IValidTestResult, parseUintType} from "../utils";
import path from "path";
import {deserialize, equals, hashTreeRoot, serialize, signingRoot, Type, UintType} from "../../../../src";
import {expect} from "chai";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {fromYaml} from "@chainsafe/eth2.0-utils";

describeDirectorySpecTest<IValidGenericSSZTestCase, IValidTestResult>(
  "valid_bitvector",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/uints/valid"),
  ((testCase, directoryName) => {
    const typeDetails = parseUintType(directoryName);
    const uintType: UintType = {
      type: Type.uint,
      useNumber: typeDetails.size < 53,
      byteLength: Math.ceil(typeDetails.size/8)
    };
    return {
      decoded: deserialize(
        testCase.serialized_raw,
        uintType
      ),
      encoded: serialize(
        testCase.value,
        uintType
      ),
      root: hashTreeRoot(
        testCase.value,
        uintType
      ),
      signingRoot: !testCase.meta.signingRoot ?
        null :
      // @ts-ignore
        signingRoot(testCase.value, uintType),
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
        const typeDetails = parseUintType(directoryName);
        const uintType: UintType = {
          type: Type.uint,
          useNumber: typeDetails.size < 53,
          byteLength: Math.ceil(typeDetails.size/8)
        };
        return fromYaml(
          value,
          uintType
        );
      }
    },
    expectFunc:
        (testCase: IValidGenericSSZTestCase, expected: any, actual: IValidTestResult, directoryName: string) => {
          const typeDetails = parseUintType(directoryName);
          const uintType: UintType = {
            type: Type.uint,
            useNumber: typeDetails.size < 53,
            byteLength: Math.ceil(typeDetails.size/8)
          };
          expect(
            equals(
              actual.decoded,
              testCase.value,
              uintType
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