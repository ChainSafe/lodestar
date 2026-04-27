import fs from "node:fs";
import path from "node:path";
import {describe, it} from "vitest";
import {ACTIVE_PRESET} from "@lodestar/params";
import {complianceForkChoiceSpecTests} from "../specTestVersioning.js";
import {forkChoiceTest} from "../utils/forkChoiceRunner.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType} from "../utils/types.js";

// Compliance fork choice tests share the standard spec-test layout under each
// config archive (verified against the `small.tar.gz` artifact from the
// consensus-specs "Compliance Tests" workflow):
//
//   spec-tests-compliance/<config>/tests/<preset>/<fork>/fork_choice_compliance/<handler>/<suite>/<case>/
//
// We reuse `specTestIterator` and register a runner under the name
// `fork_choice_compliance` (consensus-specs naming, not Prysm's
// `compliance_fork_choice`). Each config gets a `compliance_fork_choice/<config>/`
// prefix on its test IDs so reports can differentiate when multiple configs
// are extracted side-by-side.

for (const configName of complianceForkChoiceSpecTests.configs) {
  const configRoot = path.join(complianceForkChoiceSpecTests.outputDir, configName);

  if (!fs.existsSync(configRoot)) {
    describe(`compliance_fork_choice/${configName}`, () => {
      it.skip(
        `compliance test data not present at ${configRoot}; ` +
          `run \`./scripts/download-compliance-fc-tests.sh --config ${configName}\` to fetch`,
        () => {}
      );
    });
    continue;
  }

  // The published artifact extracts to `<config>/tests/<preset>/...` but allow a
  // flatter `<config>/<preset>/...` layout in case future tarballs drop the prefix.
  const presetRoot = [path.join(configRoot, "tests", ACTIVE_PRESET), path.join(configRoot, ACTIVE_PRESET)].find((p) =>
    fs.existsSync(p)
  );

  if (presetRoot === undefined) {
    describe(`compliance_fork_choice/${configName}/${ACTIVE_PRESET}`, () => {
      it.skip(`compliance ${configName} archive does not contain preset ${ACTIVE_PRESET}`, () => {});
    });
    continue;
  }

  specTestIterator(
    presetRoot,
    {
      fork_choice_compliance: {
        type: RunnerType.default,
        fn: forkChoiceTest({onlyPredefinedResponses: false}),
      },
    },
    undefined,
    `compliance_fork_choice/${configName}/`
  );
}
