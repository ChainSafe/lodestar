import path from "node:path";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";
import {blsTestRunner} from "./bls.js";
import {kzgTestRunner} from "./kzg.js";

// NOTE: Every skipped test must include a detailed reason, a tracking issue, and
// an approximate timeline or condition for re-enabling it.
// Skip the smallest possible set of tests, e.g. one fork or case instead of an entire runner.
// Shared skips belong in defaultSkipOpts in ../utils/specTestIterator.js.
specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", "general"), {
  bls: {type: RunnerType.default, fn: blsTestRunner},
  kzg: {type: RunnerType.default, fn: kzgTestRunner},
});
