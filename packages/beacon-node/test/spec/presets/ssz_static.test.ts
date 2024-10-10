import fs from "node:fs";
import path from "node:path";
import {expect, it, vi} from "vitest";
import {Type} from "@chainsafe/ssz";
import {ssz, sszTypesFor} from "@lodestar/types";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {replaceUintTypeWithUintBigintType} from "../utils/replaceUintTypeWithUintBigintType.js";
import {parseSszStaticTestcase} from "../utils/sszTestCaseParser.js";
import {runValidSszTest} from "../utils/runValidSszTest.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";

// ssz_static
// | Attestation
//   | ssz_nil
//     | case_0
//       | roots.yaml
//       | serialized.ssz_snappy
//       | value.yaml
//
// Docs: https://github.com/ethereum/consensus-specs/blob/master/tests/formats/ssz_static/core.md

type Types = Record<string, Type<any>>;

// Mapping of sszGeneric() fn arguments to the path in spec tests
//
//       / config  / fork   / test runner      / test handler / test suite   / test case
//
// tests / mainnet / altair / ssz_static       / Validator    / ssz_random   / case_0/roots.yaml
//

const sszStatic =
  (skippedFork: string, skippedTypes?: string[]) =>
  (fork: ForkName, typeName: string, _testSuite: string, testSuiteDirpath: string): void => {
    if (fork === skippedFork) {
      return;
    }

    // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    if (skippedTypes?.includes(typeName)) {
      return;
    }

    /* eslint-disable @typescript-eslint/strict-boolean-expressions */
    const sszType =
      (sszTypesFor(fork) as Types)[typeName] ||
      (ssz.electra as Types)[typeName] ||
      (ssz.deneb as Types)[typeName] ||
      (ssz.capella as Types)[typeName] ||
      (ssz.bellatrix as Types)[typeName] ||
      (ssz.altair as Types)[typeName] ||
      (ssz.phase0 as Types)[typeName];

    it(`${fork} - ${typeName} type exists`, function () {
      expect(sszType).toEqualWithMessage(expect.any(Type), `SSZ type ${typeName} for fork ${fork} is not defined`);
    });

    if (!sszType) {
      // Return instead of throwing an error to only skip ssz_static tests associated to missing type
      return;
    }

    const sszTypeNoUint = replaceUintTypeWithUintBigintType(sszType);

    for (const testCase of fs.readdirSync(testSuiteDirpath)) {
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
      it(testCase, function () {
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
    // starting from v1.4.0-beta.6, there is "whisk" fork in ssz_static tests but we ignore them
    fn: sszStatic("whisk"),
  },
});
