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
  // The pinned vector predates consensus-specs#5821, its payload carries withdrawals the block's post-state
  // does not expect. Unskip with the next spec release.
  /^gossip_execution_payload_envelope\/gossip_execution_payload_envelope__valid_max_withdrawals$/,
  // The bid in this vector has a gas limit of 0, so the envelope is ignored by the transaction count bound
  // before the empty transaction check rejects it. Not part of the pinned vectors yet.
  /^gossip_execution_payload_envelope\/gossip_execution_payload_envelope__reject_empty_transaction$/,
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
