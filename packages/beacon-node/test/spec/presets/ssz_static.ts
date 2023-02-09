import fs from "node:fs";
import path from "node:path";
import {ssz} from "@lodestar/types";
import {Type} from "@chainsafe/ssz";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {replaceUintTypeWithUintBigintType} from "../utils/replaceUintTypeWithUintBigintType.js";
import {parseSszStaticTestcase} from "../utils/sszTestCaseParser.js";
import {runValidSszTest} from "../utils/runValidSszTest.js";

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

export const sszStatic = (skippedTypes?: string[], overrideSSZTypes?: Record<string, Types>) => (
  fork: ForkName,
  typeName: string,
  testSuite: string,
  testSuiteDirpath: string
): void => {
  // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
  if (skippedTypes?.includes(typeName)) {
    return;
  }

  /* eslint-disable @typescript-eslint/strict-boolean-expressions */
  const sszType =
    (((overrideSSZTypes ?? {})[fork] ?? {}) as Types)[typeName] ||
    (ssz[fork] as Types)[typeName] ||
    (ssz.capella as Types)[typeName] ||
    (ssz.bellatrix as Types)[typeName] ||
    (ssz.altair as Types)[typeName] ||
    (ssz.phase0 as Types)[typeName];
  if (!sszType) {
    throw Error(`No type for ${typeName}`);
  }

  const sszTypeNoUint = replaceUintTypeWithUintBigintType(sszType);

  for (const testCase of fs.readdirSync(testSuiteDirpath)) {
    // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    it(testCase, function () {
      // Mainnet must deal with big full states and hash each one multiple times
      if (ACTIVE_PRESET === "mainnet") {
        this.timeout(30 * 1000);
      }

      const testData = parseSszStaticTestcase(path.join(testSuiteDirpath, testCase));
      runValidSszTest(sszTypeNoUint, testData);
    });
  }
};
