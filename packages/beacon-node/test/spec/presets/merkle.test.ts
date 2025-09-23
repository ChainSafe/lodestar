import path from "node:path";
import {expect} from "vitest";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {ACTIVE_PRESET, ForkAll} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {BeaconBlockBody, SSZTypesFor, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";

const merkle: TestRunnerFn<MerkleTestCase, string[]> = (fork) => {
  return {
    testFunction: (testcase) => {
      const bodyView = (ssz[fork].BeaconBlockBody as SSZTypesFor<ForkAll, "BeaconBlockBody">).toView(testcase.object);
      const branch = new Tree(bodyView.node).getSingleProof(testcase.proof.leaf_index);
      return branch.map(toHex);
    },
    options: {
      inputTypes: {
        object: InputType.SSZ_SNAPPY,
        proof: InputType.YAML,
      },
      getSszTypes: () => ({
        object: ssz[fork].BeaconBlockBody,
      }),
      timeout: 10000,
      shouldSkip: (_testCase, name) => {
        // TODO-das: investigate why these tests are failing but passed for unstable
        return name.includes("random_block") || name.includes("blob_kzg_commitments");
      },
      getExpected: (testCase) => testCase.proof.branch,
      expectFunc: (_testCase, expected, actual) => {
        expect(actual).deep.equals(expected);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type MerkleTestCase = {
  meta?: any;
  object: BeaconBlockBody;
  proof: IProof;
};

interface IProof {
  leaf: string;
  leaf_index: bigint;
  branch: string[];
}

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  merkle_proof: {type: RunnerType.default, fn: merkle},
});
