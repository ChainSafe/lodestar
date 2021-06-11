import {describeDirectorySpecTest, InputType, safeType} from "@chainsafe/lodestar-spec-test-util";
import {Bytes32, ssz} from "@chainsafe/lodestar-types";
import {join} from "path";
import {expect} from "chai";
import {CompositeType} from "@chainsafe/ssz";
import {IBaseSSZStaticTestCase} from "../type";
import {SPEC_TEST_LOCATION} from "../../../utils/specTestCases";
import {ForkName, PresetName} from "@chainsafe/lodestar-params";

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, no-console */

interface IResult {
  root: Bytes32;
  serialized: Uint8Array;
}

export function testStaticPhase0(type: keyof typeof ssz["phase0"], preset: PresetName): void {
  const sszType = safeType(ssz.phase0[type]) as CompositeType<any>;
  testStatic(type, sszType, ForkName.phase0, preset);
}

type NewAltairTypes = {
  fork: ForkName.altair;
  type: keyof typeof ssz["altair"];
};

type AltairTypesFromPhase0 = {
  fork: ForkName.phase0;
  type: keyof typeof ssz["phase0"];
};

export function testStaticAltair(typeWithFork: NewAltairTypes | AltairTypesFromPhase0, preset: PresetName): void {
  let sszType: CompositeType<any> | undefined;
  if (typeWithFork.fork === ForkName.phase0) {
    sszType = safeType(ssz.phase0[typeWithFork.type]) as CompositeType<any>;
  } else if (typeWithFork.fork === ForkName.altair) {
    sszType = safeType(ssz.altair[typeWithFork.type]) as CompositeType<any>;
  }
  if (!sszType) {
    throw new Error(`Not found type for fork ${typeWithFork.fork} and type ${typeWithFork.type}`);
  }
  testStatic(typeWithFork.type, sszType, ForkName.altair, preset);
}

function testStatic(type: string, sszType: CompositeType<any>, forkName: ForkName, preset: PresetName): void {
  const caseNames =
    preset === PresetName.mainnet
      ? ["ssz_random"]
      : ["ssz_lengthy", "ssz_max", "ssz_one", "ssz_nil", "ssz_random", "ssz_random_chaos", "ssz_zero"];
  for (const caseName of caseNames) {
    describeDirectorySpecTest<IBaseSSZStaticTestCase<any>, IResult>(
      `SSZ - ${type} ${caseName} ${preset}`,
      join(SPEC_TEST_LOCATION, `tests/${preset}/${forkName}/ssz_static/${type}/${caseName}`),
      (testcase) => {
        //debugger;
        const serialized = sszType.serialize(testcase.serialized);
        const root = sszType.hashTreeRoot(testcase.serialized);
        return {
          serialized,
          root,
        };
      },
      {
        inputTypes: {
          roots: InputType.YAML,
          serialized: InputType.SSZ_SNAPPY,
        },
        sszTypes: {
          serialized: sszType,
        },
        getExpected: (testCase) => {
          return {
            root: Buffer.from(testCase.roots.root.replace("0x", ""), "hex"),
            serialized: testCase.serialized_raw,
          };
        },
        expectFunc: (testCase, expected, actual) => {
          if (true && (!expected.serialized.equals(actual.serialized) || !expected.root.equals(actual.root))) {
            console.log("testCase", testCase);
            console.log("serialize expected", expected.serialized.toString("hex"));
            console.log("serialize actual  ", Buffer.from(actual.serialized).toString("hex"));
            console.log("hashTreeRoot expected", expected.root.toString("hex"));
            console.log("hashTreeRoot actual  ", Buffer.from(actual.root).toString("hex"));
            /*
            const bbroot = Type.fields[2][1]
            console.log("s bbroot hash", bbroot.hashTreeRoot(structural.beaconBlockRoot))
            console.log("t bbroot hash", bbroot.hashTreeRoot(tree.beaconBlockRoot))
               */
            // debugger;
          }
          const structural = sszType.deserialize(testCase.serialized_raw);
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const tree = sszType.createTreeBackedFromBytes(testCase.serialized_raw);
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          const treeFromStructural = sszType.createTreeBackedFromStruct(structural);
          expect(tree.serialize(), "tree serialization != structural serialization").to.deep.equal(
            sszType.serialize(structural)
          );
          expect(sszType.equals(tree, treeFromStructural), "tree != treeFromStructural");
          expect(expected.serialized.equals(sszType.serialize(structural)));
          expect(expected.root.equals(sszType.hashTreeRoot(structural)));
          expect(expected.serialized.equals(actual.serialized), "incorrect serialize").to.be.true;
          expect(expected.root.equals(actual.root), "incorrect hashTreeRoot").to.be.true;
        },
        //shouldSkip: (a, b, i) => i !== 0,
        //shouldSkip: (a, b, i) => b !== 'case_10',
      }
    );
  }
}
