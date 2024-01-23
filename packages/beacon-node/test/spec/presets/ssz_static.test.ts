import fs from "node:fs";
import path from "node:path";
import {it, vi} from "vitest";
import {Type} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {ACTIVE_PRESET, ForkName, ForkLightClient} from "@lodestar/params";
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
  (fork: ForkName, typeName: string, testSuite: string, testSuiteDirpath: string): void => {
    if (fork === skippedFork) {
      return;
    }

    // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    if (skippedTypes?.includes(typeName)) {
      return;
    }

    /* eslint-disable @typescript-eslint/strict-boolean-expressions */
    const sszType =
      // Since lightclient types are not updated/declared at all forks, this allForksLightClient
      // will help us get the right type for lightclient objects
      ((ssz.allForksLightClient[fork as ForkLightClient] || {}) as Types)[typeName] ||
      (ssz[fork] as Types)[typeName] ||
      (ssz.deneb as Types)[typeName] ||
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
      // eslint-disable-next-line vitest/consistent-test-it
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
  // eslint-disable-next-line @typescript-eslint/naming-convention
  ssz_static: {
    type: RunnerType.custom,
    // starting from v1.4.0-beta.6, there is "whisk" fork in ssz_static tests but we ignore them
    fn: sszStatic("whisk"),
  },
});
