import path from "node:path";
import {pinnedSpecFixtureVersions, specFixturesDir} from "@lodestar/spec-test-util/fixtures";

export const SPEC_TEST_VERSION = pinnedSpecFixtureVersions().interchange;
export const SPEC_TEST_CASES_LOCATION = path.join(
  specFixturesDir,
  "interchange",
  SPEC_TEST_VERSION,
  `slashing-protection-interchange-tests-${SPEC_TEST_VERSION.slice(1)}`,
  "tests/generated"
);
