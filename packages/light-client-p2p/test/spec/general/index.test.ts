import path from "node:path";
import {RunnerType} from "../utils/types.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {blsTestRunner} from "./bls.js";
import {sszGeneric} from "./ssz_generic.js";

/* eslint-disable @typescript-eslint/naming-convention */

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", "general"), {
  bls: {type: RunnerType.default, fn: blsTestRunner},
  ssz_generic: {type: RunnerType.custom, fn: sszGeneric},
});
