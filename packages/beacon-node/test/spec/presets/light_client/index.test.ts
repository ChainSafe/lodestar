import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {ethereumConsensusSpecsTests} from "../../specTestVersioning.js";
import {specTestIterator} from "../../utils/specTestIterator.js";
import {RunnerType, TestRunnerFn} from "../../utils/types.js";
import {singleMerkleProof} from "./single_merkle_proof.js";
import {sync} from "./sync.js";
import {updateRanking} from "./update_ranking.js";

const lightClient: TestRunnerFn<any, any> = (fork, testName, testSuite) => {
  const testFn = lightclientTestFns[testName];
  if (testFn === undefined) {
    throw Error(`Unknown lightclient test ${testName}`);
  }

  return testFn(fork, testName, testSuite);
};

const lightclientTestFns: Record<string, TestRunnerFn<any, any>> = {
  single_merkle_proof: singleMerkleProof,
  sync: sync,
  update_ranking: updateRanking,
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  light_client: {type: RunnerType.default, fn: lightClient},
});
