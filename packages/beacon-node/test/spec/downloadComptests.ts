import {downloadComptests} from "@lodestar/spec-test-util/downloadComptests";
import {ethereumConsensusSpecsTests} from "./specTestVersioning.js";

// The comptests pin is independent of the standard spec-tests pin: pre-gloas fork-choice
// semantics are identical between alpha.11 and alpha.12 (rename-only spec delta), so the
// alpha.12 vectors are valid while unstable still pins alpha.11. Collapse this into
// `ethereumConsensusSpecsTests.specVersion` once the standard pin reaches v1.7.0-alpha.12
// (PR #9390).
const COMPTESTS_SPEC_VERSION = "v1.7.0-alpha.12";

await downloadComptests(
  {
    specVersion: COMPTESTS_SPEC_VERSION,
    outputDir: ethereumConsensusSpecsTests.outputDir,
    specTestsRepoUrl: ethereumConsensusSpecsTests.specTestsRepoUrl,
  },
  console.log
).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
