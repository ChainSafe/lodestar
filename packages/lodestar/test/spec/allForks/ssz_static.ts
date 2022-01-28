import fs from "node:fs";
import path from "node:path";
import {describeDirectorySpecTest, InputType, safeType} from "@chainsafe/lodestar-spec-test-util";
import {Bytes32, ssz} from "@chainsafe/lodestar-types";
import {expect} from "chai";
import {CompositeType, ContainerType, Type} from "@chainsafe/ssz";
import {IBaseSSZStaticTestCase} from "../ssz/type";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {ACTIVE_PRESET, ForkName, PresetName} from "@chainsafe/lodestar-params";

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, no-console */

// eslint-disable-next-line
type Types = Record<string, Type<any>>;

const extraTypes = {
  Eth1Block: new ContainerType({
    fields: {
      timestamp: ssz.Number64,
      depositRoot: ssz.Root,
      depositCount: ssz.Number64,
    },
  }),
};

export function sszStatic(fork: ForkName): void {
  const rootDir = path.join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/${fork}/ssz_static`);
  for (const typeName of fs.readdirSync(rootDir)) {
    const type =
      ((ssz[fork] as Types)[typeName] as Type<any> | undefined) ||
      ((ssz.altair as Types)[typeName] as Type<any> | undefined) ||
      ((ssz.phase0 as Types)[typeName] as Type<any> | undefined) ||
      ((extraTypes as Types)[typeName] as Type<any> | undefined);
    if (!type) {
      throw Error(`No type for ${typeName}`);
    }

    const sszType = safeType(type) as CompositeType<any>;
    testStatic(typeName, sszType, fork, ACTIVE_PRESET);
  }
}

interface IResult {
  root: Bytes32;
  serialized: Uint8Array;
}

function testStatic(typeName: string, sszType: CompositeType<any>, forkName: ForkName, preset: PresetName): void {
  const typeDir = path.join(SPEC_TEST_LOCATION, `tests/${preset}/${forkName}/ssz_static/${typeName}`);

  for (const caseName of fs.readdirSync(typeDir)) {
    describeDirectorySpecTest<IBaseSSZStaticTestCase<any>, IResult>(
      `${preset}/${forkName}/ssz_static/${typeName}/${caseName}`,
      path.join(typeDir, caseName),
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
