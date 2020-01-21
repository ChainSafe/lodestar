import {describeDirectorySpecTest, InputType, safeType} from "@chainsafe/eth2.0-spec-test-util";
import {bytes32, IBeaconSSZTypes} from "@chainsafe/eth2.0-types";
import {join} from "path";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";
import {expect} from "chai";
import {hashTreeRoot, serialize, parseType} from "@chainsafe/ssz";

import {IBaseSSZStaticTestCase} from "../type";

export const TEST_CASE_LOCATION = "../../../../../../node_modules/@chainsafe/eth2-spec-tests";

interface IResult {
  root: bytes32;
  serialized: Buffer;
}

export function testStatic(type: keyof IBeaconSSZTypes): void {
  const Type = safeType(parseType(config.types[type]));

  ["ssz_lengthy", "ssz_max", "ssz_nil", "ssz_one", "ssz_random", "ssz_random_chaos", "ssz_zero"].forEach((caseName) => {

    describeDirectorySpecTest<IBaseSSZStaticTestCase<any>, IResult>(
      `SSZ - ${type} ${caseName} minimal`,
      join(__dirname, `${TEST_CASE_LOCATION}/tests/minimal/phase0/ssz_static/${type}/${caseName}`),
      (testcase) => {
        const serialized = serialize(Type, testcase.serialized);
        const root = hashTreeRoot(Type, testcase.serialized);
        return {
          serialized,
          root
        };
      },
      {
        // @ts-ignore
        inputTypes: {
          roots: InputType.YAML,
          serialized: InputType.SSZ
        },
        // @ts-ignore
        sszTypes: {
          serialized: Type,
        },
        getExpected: (testCase => {
          return {
            root: Buffer.from(testCase.roots.root.replace("0x", ""), "hex"),
            // @ts-ignore
            serialized: testCase.serialized_raw
          };
        }),
        expectFunc: (testCase, expected, actual) => {
          expect(expected.serialized.equals(actual.serialized)).to.be.true;
          expect(expected.root.equals(actual.root)).to.be.true;
        },
      }
    );
  });
}
