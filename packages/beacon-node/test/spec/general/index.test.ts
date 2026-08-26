import path from "node:path";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {SkipOpts, specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";
import {blsTestRunner} from "./bls.js";
import {kzgTestRunner} from "./kzg.js";

// NOTE: You MUST always provide a detailed reason of why a spec test is skipped plus link
// to an issue marking it as pending to re-enable and an aproximate timeline of when it will
// be fixed.
// NOTE: Comment the minimum set of test necessary to unblock PRs: For example, instead of
// skipping all `bls_to_execution_change` tests, just skip for a fork setting:
// ```
// skippedPrefixes: [
//    // Skipped since this only test that withdrawals are de-activated
//    "eip4844/operations/bls_to_execution_change",
// ],
// ```
const skipOpts: SkipOpts = {
  skippedHandlers: ["compute_challenge", "compute_verify_cell_kzg_proof_batch_challenge"],
  skippedTests: [],
};

specTestIterator(
  path.join(ethereumConsensusSpecsTests.outputDir, "tests", "general"),
  {
    bls: {type: RunnerType.default, fn: blsTestRunner},
    kzg: {type: RunnerType.default, fn: kzgTestRunner},
  },
  skipOpts
);
