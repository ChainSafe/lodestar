import fs from "node:fs";
import path from "node:path";
import {expect, it, vi} from "vitest";
import snappyWasm from "@chainsafe/snappy-wasm";
import {CompositeTypeAny, Type} from "@chainsafe/ssz";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {replaceUintTypeWithUintBigintType} from "../utils/replaceUintTypeWithUintBigintType.js";
import {runValidSszTest} from "../utils/runValidSszTest.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {parseSszStaticTestcase} from "../utils/sszTestCaseParser.js";
import {RunnerType} from "../utils/types.js";

// ssz_static
// | Attestation
//   | ssz_nil
//     | case_0
//       | roots.yaml
//       | serialized.ssz_snappy
//       | value.yaml
//
// Docs: https://github.com/ethereum/consensus-specs/blob/v1.6.1/tests/formats/ssz_static/core.md

type Types = Record<string, Type<any>>;

// Spec type names that differ from the Lodestar export
const typeNameAliases: Record<string, string> = {
  BLSToExecutionChanges: "BlsToExecutionChanges",
  BlobKZGCommitments: "BlobKzgCommitments",
};

// Mapping of sszGeneric() fn arguments to the path in spec tests
//
//       / config  / fork   / test runner      / test handler / test suite   / test case
//
// tests / mainnet / altair / ssz_static       / Validator    / ssz_random   / case_0/roots.yaml
//

const sszStatic =
  (skippedFork: string, skippedTypes?: string[]) =>
  (fork: ForkName, specTypeName: string, testSuite: string, testSuiteDirpath: string): void => {
    if (fork === skippedFork) {
      return;
    }

    // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    if (skippedTypes?.includes(specTypeName)) {
      return;
    }

    const typeName = typeNameAliases[specTypeName] ?? specTypeName;
    const sszType =
      (sszTypesFor(fork) as Types)[typeName] ||
      (ssz.gloas as Types)[typeName] ||
      (ssz.fulu as Types)[typeName] ||
      (ssz.electra as Types)[typeName] ||
      (ssz.deneb as Types)[typeName] ||
      (ssz.capella as Types)[typeName] ||
      (ssz.bellatrix as Types)[typeName] ||
      (ssz.altair as Types)[typeName] ||
      (ssz.phase0 as Types)[typeName];

    it(`${fork} - ${typeName} type exists`, () => {
      expect(sszType).toEqualWithMessage(expect.any(Type), `SSZ type ${typeName} for fork ${fork} is not defined`);
    });

    if (!sszType) {
      // Return instead of throwing an error to only skip ssz_static tests associated to missing type
      return;
    }

    // A list one past its declared limit, the bytes must be rejected before any element is materialized.
    // Checked on the type as declared, the uint replacement below rebuilds lists for value decoding only.
    if (testSuite === "ssz_over_limit") {
      for (const testCase of fs.readdirSync(testSuiteDirpath)) {
        it(testCase, () => {
          const serialized = snappyWasm.decompress(
            fs.readFileSync(path.join(testSuiteDirpath, testCase, "serialized.ssz_snappy"))
          );
          expect(() => sszType.deserialize(serialized)).toThrow();
          if ("deserializeToViewDU" in sszType) {
            expect(() => (sszType as CompositeTypeAny).deserializeToViewDU(serialized)).toThrow();
          }
        });
      }
      return;
    }

    const sszTypeNoUint = replaceUintTypeWithUintBigintType(sszType);

    for (const testCase of fs.readdirSync(testSuiteDirpath)) {
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
      it(testCase, () => {
        // Mainnet must deal with big full states and hash each one multiple times
        if (ACTIVE_PRESET === "mainnet") {
          vi.setConfig({testTimeout: 30 * 1000});
        }

        const testData = parseSszStaticTestcase(path.join(testSuiteDirpath, testCase));
        runValidSszTest(sszTypeNoUint, testData);
      });
    }
  };

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  ssz_static: {
    type: RunnerType.custom,
    // starting from v1.5.0-beta.3, there is "eip7441" fork in ssz_static tests but we ignore them
    fn: sszStatic("eip7441"),
  },
});
