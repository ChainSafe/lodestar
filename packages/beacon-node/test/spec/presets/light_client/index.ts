import {TestRunnerFn} from "../../utils/types.js";
import {singleMerkleProof} from "./single_merkle_proof.js";
import {sync} from "./sync.js";
import {updateRanking} from "./update_ranking.js";

/* eslint-disable @typescript-eslint/naming-convention */

export const lightClient: TestRunnerFn<any, any> = (fork, testName, testSuite) => {
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
