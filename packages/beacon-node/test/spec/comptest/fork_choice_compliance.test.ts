import fs from "node:fs";
import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {forkChoiceTestRunner} from "../utils/forkChoiceTestRunner.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";

// Fork-choice compliance suite (`pnpm test:comptest`) — its own vitest project, never part of
// the regular spec runs. Fixtures via `pnpm download-comptests`.

// Zero-test guard: the workspace vitest config sets `passWithNoTests: true`, so without this a
// run against missing fixtures would silently pass.
const presetDir = path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET);
const hasComplianceFixtures =
  fs.existsSync(presetDir) &&
  fs.readdirSync(presetDir).some((fork) => fs.existsSync(path.join(presetDir, fork, "fork_choice_compliance")));
if (!hasComplianceFixtures) {
  throw Error("No fork_choice_compliance fixtures found — run `pnpm download-comptests` first");
}

specTestIterator(presetDir, {
  fork_choice_compliance: {type: RunnerType.default, fn: forkChoiceTestRunner({onlyPredefinedResponses: false})},
});
