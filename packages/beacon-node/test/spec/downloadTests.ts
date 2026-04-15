import path from "node:path";
import {config} from "dotenv";
import {downloadNightlyTests} from "@lodestar/spec-test-util/downloadNightlyTests";
import {downloadTests} from "@lodestar/spec-test-util/downloadTests";
import {blsSpecTests, ethereumConsensusSpecsTests} from "./specTestVersioning.js";

const onError = (e: Error): void => {
  console.error(e);
  process.exit(1);
};

const [nightlyArg, repo, branch] = process.argv.slice(2);

if (nightlyArg) {
  config({path: path.join(import.meta.dirname, "../../../../.env")});

  const opts = {
    ...ethereumConsensusSpecsTests,
    ...(repo && {specTestsRepoUrl: `https://github.com/${repo}`}),
    ...(branch && {branch}),
  };

  downloadTests(blsSpecTests, console.log).catch(onError);
  downloadNightlyTests(opts, console.log, nightlyArg).catch(onError);
} else {
  for (const opts of [ethereumConsensusSpecsTests, blsSpecTests]) {
    downloadTests(opts, console.log).catch(onError);
  }
}
