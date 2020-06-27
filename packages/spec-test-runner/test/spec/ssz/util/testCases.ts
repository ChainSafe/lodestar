import {describeDirectorySpecTest, InputType, safeType} from "@chainsafe/lodestar-spec-test-util";
import {Bytes32, IBeaconSSZTypes} from "@chainsafe/lodestar-types";
import {join} from "path";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";
import {expect} from "chai";

import {IBaseSSZStaticTestCase} from "../type";
import { CompositeType } from "@chainsafe/ssz";

export const TEST_CASE_LOCATION = "../../../../../../node_modules/@chainsafe/eth2-spec-tests";

interface IResult {
  root: Bytes32;
  serialized: Uint8Array;
}

export function testStatic(type: keyof IBeaconSSZTypes): void {
  const Type = safeType(config.types[type]) as CompositeType<any>;
  [
    "ssz_lengthy",
    "ssz_max",
    "ssz_one",
    "ssz_nil",
    "ssz_random",
    "ssz_random_chaos",
    "ssz_zero",
  ].forEach((caseName) => {

    describeDirectorySpecTest<IBaseSSZStaticTestCase<any>, IResult>(
      `SSZ - ${type} ${caseName} minimal`,
      join(__dirname, `${TEST_CASE_LOCATION}/tests/minimal/phase0/ssz_static/${type}/${caseName}`),
      (testcase) => {
        const tree = testcase.serialized;
        //debugger;
        const serialized = Type.serialize(testcase.serialized);
        const root = Type.hashTreeRoot(testcase.serialized);
        return {
          serialized,
          root
        };
      },
      {
        inputTypes: {
          roots: InputType.YAML,
          serialized: InputType.SSZ
        },
        sszTypes: {
          serialized: Type,
        },
        getExpected: (testCase => {
          return {
            root: Buffer.from(testCase.roots.root.replace("0x", ""), "hex"),
            serialized: testCase.serialized_raw
          };
        }),
        expectFunc: (testCase, expected, actual) => {
          if (true && (!expected.serialized.equals(actual.serialized) || !expected.root.equals(actual.root))) {
            console.log("testCase", testCase)
            console.log("serialize expected", expected.serialized.toString('hex'))
            console.log("serialize actual  ", Buffer.from(actual.serialized).toString('hex'))
            console.log("hashTreeRoot expected", expected.root.toString('hex'))
            console.log("hashTreeRoot actual  ", Buffer.from(actual.root).toString('hex'))
            const structural = Type.deserialize(testCase.serialized_raw)
            const tree = testCase.serialized
              /*
            const bbroot = Type.fields[2][1]
            console.log("s bbroot hash", bbroot.hashTreeRoot(structural.beaconBlockRoot))
            console.log("t bbroot hash", bbroot.hashTreeRoot(tree.beaconBlockRoot))
               */
            debugger;
          }
          const structural = Type.deserialize(testCase.serialized_raw)
          expect(expected.serialized.equals(Type.serialize(structural)))
          expect(expected.root.equals(Type.hashTreeRoot(structural)))
          expect(expected.serialized.equals(actual.serialized), "incorrect serialize").to.be.true;
          expect(expected.root.equals(actual.root), "incorrect hashTreeRoot").to.be.true;
        },
        //shouldSkip: (a, b, i) => i !== 0,
        //shouldSkip: (a, b, i) => b !== 'case_10',
      }
    );
  });
}
