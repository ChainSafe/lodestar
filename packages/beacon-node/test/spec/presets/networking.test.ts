import path from "node:path";
import {it} from "vitest";
import {config} from "@lodestar/config/default";
import {ACTIVE_PRESET} from "@lodestar/params";
import {InputType, describeDirectorySpecTest} from "@lodestar/spec-test-util";
import {bigIntToBytes} from "@lodestar/utils";
import {computeColumnsForCustodyGroup, getCustodyGroups} from "../../../src/util/dataColumns.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {runGossipValidationTest} from "../utils/gossipValidation.js";
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
    for (const testCaseName of readdirSyncSpec(testSuiteDirpath)) {
      const testCaseDir = path.join(testSuiteDirpath, testCaseName);
      it(testCaseName, async () => {
        await runGossipValidationTest(fork, testHandler, testCaseDir);
      }, 30_000);
    }
  } else {
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
