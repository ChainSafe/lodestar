import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {bigIntToBytes} from "@lodestar/utils";
import {computeColumnsForCustodyGroup, getCustodyGroups} from "../../../src/util/dataColumns.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";

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
    return computeColumnsForCustodyGroup(Number(input.custody_group));
  },
  get_custody_groups(input: GetCustodyGroupInput): number[] {
    return getCustodyGroups(bigIntToBytes(input.node_id, 32, "be"), input.custody_group_count);
  },
};

const networking: TestRunnerFn<NetworkingTestCase, unknown> = (_fork, testName) => {
  return {
    testFunction: (testcase) => {
      const networkingFn = networkingFns[testName];
      if (networkingFn === undefined) {
        throw Error(`No networkingFn for ${testName}`);
      }

      return networkingFn(testcase.meta);
    },
    options: {
      inputTypes: {meta: InputType.YAML},
      getExpected: (testCase) => testCase.meta.result.map(Number),
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type NetworkingTestCase = {
  meta: {
    result: number[];
  };
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  networking: {type: RunnerType.default, fn: networking},
});
