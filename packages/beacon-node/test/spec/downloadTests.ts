import path from "node:path";
import {config} from "dotenv";
import {downloadNightlyTests} from "@lodestar/spec-test-util/downloadNightlyTests";
import {downloadTests} from "@lodestar/spec-test-util/downloadTests";
import {blsSpecTests, ethereumConsensusSpecsTests} from "./specTestVersioning.js";

const [date, repo, branch] = process.argv.slice(2);
const downloads = [downloadTests(blsSpecTests, console.log)];

if (date) {
  config({path: path.join(import.meta.dirname, "../../../../.env")});

  const opts = {
    ...ethereumConsensusSpecsTests,
    ...(repo && {specTestsRepoUrl: `https://github.com/${repo}`}),
    ...(branch && {branch}),
  };

  downloads.push(downloadNightlyTests(opts, console.log, date));
} else {
  downloads.push(downloadTests(ethereumConsensusSpecsTests, console.log));
}

await Promise.all(downloads).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
