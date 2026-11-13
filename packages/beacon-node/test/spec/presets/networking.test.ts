import fs from "node:fs";
import path from "node:path";
import {expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {ACTIVE_PRESET} from "@lodestar/params";
import {bigIntToBytes, loadYaml} from "@lodestar/utils";
import {computeColumnsForCustodyGroup, getCustodyGroups} from "../../../src/util/dataColumns.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {isGossipValidationHandler, runGossipValidationTest} from "../utils/gossipValidation.js";
import {readdirSyncSpec, specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType, TestRunnerCustom} from "../utils/types.js";

type ComputeColumnForCustodyGroupInput = {
  custody_group: number;
};

type GetCustodyGroupInput = {
  node_id: bigint;
  custody_group_count: number;
};

type NetworkFn = (input: any) => number[];

const networkingFns: Record<string, NetworkFn> = {
  compute_columns_for_custody_group(input: ComputeColumnForCustodyGroupInput): number[] {
    return computeColumnsForCustodyGroup(config, Number(input.custody_group));
  },
  get_custody_groups(input: GetCustodyGroupInput): number[] {
    return getCustodyGroups(config, bigIntToBytes(input.node_id, 32, "be"), input.custody_group_count);
  },
};

type NetworkingTestCase = {
  meta: {
    result: number[];
  };
};

function loadNetworkingTestMeta(testCaseDir: string): NetworkingTestCase["meta"] {
  return loadYaml<NetworkingTestCase["meta"]>(fs.readFileSync(path.join(testCaseDir, "meta.yaml"), "utf8"));
}

function runNetworkingFnTests(testHandler: string, testSuite: string, testSuiteDirpath: string): void {
  const networkingFn = networkingFns[testHandler];
  if (networkingFn === undefined) {
    throw Error(`No networkingFn for ${testHandler}`);
  }

  for (const testCaseName of readdirSyncSpec(testSuiteDirpath)) {
    const testCaseDir = path.join(testSuiteDirpath, testCaseName);
    it(testCaseName, () => {
      const meta = loadNetworkingTestMeta(testCaseDir);
      const actual = networkingFn(meta);
      expect(actual).toEqualWithMessage(
        meta.result.map(Number),
        `Unexpected networking result for ${testHandler}/${testSuite}/${testCaseName}`
      );
    });
  }
}

/** Matched against `<handler>/<testCase>` */
const skippedGossipTests: RegExp[] = [
  // Envelopes in these vectors carry a placeholder block hash, so the block hash check from
  // consensus-specs#5770 rejects them. Unskip once the vectors are regenerated with real hashes.
  /^gossip_execution_payload_envelope\/gossip_execution_payload_envelope__(valid.*|ignore_duplicate)$/,
];

const networking: TestRunnerCustom = (fork, testHandler, testSuite, testSuiteDirpath) => {
  if (isGossipValidationHandler(testHandler)) {
    for (const testCaseName of readdirSyncSpec(testSuiteDirpath)) {
      const testCaseDir = path.join(testSuiteDirpath, testCaseName);
      const skip = skippedGossipTests.some((skippedMatch) => `${testHandler}/${testCaseName}`.match(skippedMatch));
      it.skipIf(skip)(
        testCaseName,
        async () => {
          await runGossipValidationTest(fork, testHandler, testCaseDir);
        },
        30_000
      );
    }
  } else if (networkingFns[testHandler] !== undefined) {
    runNetworkingFnTests(testHandler, testSuite, testSuiteDirpath);
  } else {
    throw new Error(`No runner for networking handler ${testHandler}`);
  }
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  networking: {type: RunnerType.custom, fn: networking},
});
