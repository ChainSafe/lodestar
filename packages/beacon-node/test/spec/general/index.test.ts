import path from "node:path";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";
import {blsTestRunner} from "./bls.js";
import {kzgTestRunner} from "./kzg.js";

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", "general"), {
  bls: {type: RunnerType.default, fn: blsTestRunner},
  kzg: {type: RunnerType.default, fn: kzgTestRunner},
});
