import {downloadComptests} from "@lodestar/spec-test-util/downloadComptests";
import {ethereumConsensusSpecsTests} from "./specTestVersioning.js";

// Same pin as the standard spec tests (spec-tests-version.json). The comptests.tar.gz release
// asset exists for every release since v1.7.0-alpha.11 (consensus-specs #5334).
await downloadComptests(
  {
    specVersion: ethereumConsensusSpecsTests.specVersion,
    outputDir: ethereumConsensusSpecsTests.outputDir,
    specTestsRepoUrl: ethereumConsensusSpecsTests.specTestsRepoUrl,
  },
  console.log
).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
