import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {forkChoiceTestRunner} from "../utils/forkChoiceTestRunner.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  fork_choice: {type: RunnerType.default, fn: forkChoiceTestRunner({onlyPredefinedResponses: false})},
  sync: {type: RunnerType.default, fn: forkChoiceTestRunner({onlyPredefinedResponses: true})},
});
