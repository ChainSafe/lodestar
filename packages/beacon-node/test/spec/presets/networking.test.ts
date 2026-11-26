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
  // Lodestar marks the proposer of every imported block as seen, so a block reusing the slot and proposer of
  // its anchor parent is ignored as a repeat proposal before the parent slot check rejects it
  /^gossip_beacon_block\/gossip_beacon_block__reject_slot_not_higher_than_parent$/,
  // A bid parent block hash that matches neither payload variant of the parent is ignored as an unknown parent
  // payload instead of rejected
  /^gossip_beacon_block\/gossip_beacon_block__reject_bid_not_on_parent_execution_head$/,
  // Lodestar ignores previous epoch attestations exactly MAXIMUM_GOSSIP_CLOCK_DISPARITY after the epoch window
  // closes, the spec includes that end point
  /^gossip_beacon_(attestation|aggregate_and_proof)\/.*__accepts_(first|last)_slot_when_epoch_window_closes$/,
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
