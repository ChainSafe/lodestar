import fs from "node:fs";
import path from "node:path";
import {ACTIVE_PRESET} from "@lodestar/params";
import {comptestsSpecTests} from "../specTestVersioning.js";
import {forkChoiceTestRunner} from "../utils/forkChoiceTestRunner.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";

// Fork-choice compliance suite (`pnpm test:comptest`) — a standalone flow parallel to the
// standard spec tests: its own vitest project, its own fixture directory
// (`zig build run:download_comptests`), sharing only the fork-choice test runner.

const presetDir = comptestsSpecTests.testsDir(ACTIVE_PRESET);
const hasComplianceFixtures =
  fs.existsSync(presetDir) &&
  fs.readdirSync(presetDir).some((fork) => fs.existsSync(path.join(presetDir, fork, "fork_choice_compliance")));
if (!hasComplianceFixtures) {
  throw Error("No fork_choice_compliance fixtures found — run `zig build run:download_comptests` first");
}

specTestIterator(presetDir, {
  fork_choice_compliance: {type: RunnerType.default, fn: forkChoiceTestRunner({onlyPredefinedResponses: false})},
});
