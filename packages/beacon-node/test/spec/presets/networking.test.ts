import path from "node:path";
import {it} from "vitest";
import {config} from "@lodestar/config/default";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {InputType, describeDirectorySpecTest} from "@lodestar/spec-test-util";
import {bigIntToBytes} from "@lodestar/utils";
import {computeColumnsForCustodyGroup, getCustodyGroups} from "../../../src/util/dataColumns.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {readdirSyncSpec, specTestIterator} from "../utils/specTestIterator.js";
import {runGossipValidationTest} from "../utils/gossipValidation.js";
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

// Tests that may need to be skipped because the checks are performed
// outside gossip validation in Lodestar (same pattern as Teku).
// Each skip must have a documented reason.
const SKIPPED_GOSSIP_TESTS = new Set<string>([
  // Lodestar currently classifies invalid attestation signature on gossip as IGNORE.
  // Spec fixture expects REJECT.
  "gossip_beacon_attestation__reject_invalid_signature",
]);

const GOSSIP_HANDLERS = new Set([
  "gossip_beacon_block",
  "gossip_beacon_aggregate_and_proof",
  "gossip_beacon_attestation",
  "gossip_proposer_slashing",
  "gossip_attester_slashing",
  "gossip_voluntary_exit",
]);

const networking: TestRunnerCustom = (fork, testHandler, testSuite, testSuiteDirpath) => {
  if (GOSSIP_HANDLERS.has(testHandler)) {
    // Gossip validation test — iterate test cases ourselves
    for (const testCaseName of readdirSyncSpec(testSuiteDirpath)) {
      if (SKIPPED_GOSSIP_TESTS.has(testCaseName)) {
        it.skip(`${testCaseName} (skipped — check done outside gossip validation)`, () => {});
        continue;
      }

      const testCaseDir = path.join(testSuiteDirpath, testCaseName);
      it(testCaseName, async () => {
        await runGossipValidationTest(fork as ForkName, testHandler, testCaseDir);
      }, 30_000);
    }
  } else {
    // Existing networking function tests (compute_columns_for_custody_group, etc.)
    const networkingFn = networkingFns[testHandler];
    if (networkingFn === undefined) {
      throw Error(`No networkingFn for ${testHandler}`);
    }

    describeDirectorySpecTest<NetworkingTestCase, unknown>(
      `${fork}/${testHandler}/${testSuite}`,
      testSuiteDirpath,
      (testcase) => networkingFn(testcase.meta),
      {
        inputTypes: {meta: InputType.YAML},
        getExpected: (testCase) => testCase.meta.result.map(Number),
      }
    );
  }
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  networking: {type: RunnerType.custom, fn: networking},
});
