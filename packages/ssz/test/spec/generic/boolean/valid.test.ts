import {describeDirectorySpecTest, InputType} from "@chainsafe/eth2.0-spec-test-util/lib/single";
import {IValidGenericSSZTestCase, IValidTestResult} from "../utils";
import path from "path";
import {deserialize, equals, hashTreeRoot, serialize, signingRoot, Type} from "../../../../src";
import {expect} from "chai";
import {TEST_CASE_LOCATION} from "../../../util/testCases";
import {fromYaml} from "@chainsafe/eth2.0-utils";
import {BoolType} from "@chainsafe/ssz-type-schema";

describeDirectorySpecTest<IValidGenericSSZTestCase, IValidTestResult>(
  "valid_boolean",
  path.join(TEST_CASE_LOCATION, "/tests/general/phase0/ssz_generic/boolean/valid"),
  ((testCase) => {
    const booleanType: BoolType = {
      type: Type.bool,
    };
    return {
      decoded: deserialize(
        testCase.serialized_raw,
        booleanType
      ),
      encoded: serialize(
        testCase.value,
        booleanType
      ),
      root: hashTreeRoot(
        testCase.value,
        booleanType
      ),
      signingRoot: !testCase.meta.signingRoot ?
        null :
      // @ts-ignore
        signingRoot(testCase.value, booleanType),
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
      value: (value: any) => {
        const booleanType: BoolType = {
          type: Type.bool,
        };
        return fromYaml(
          value,
          booleanType
        );
      }
    },
    expectFunc:
        (testCase: IValidGenericSSZTestCase, expected: any, actual: IValidTestResult) => {
          const booleanType: BoolType = {
            type: Type.bool,
          };
          expect(
            equals(
              actual.decoded,
              testCase.value,
              booleanType
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