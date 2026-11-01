import fs from "node:fs";
import path from "node:path";
import {config} from "dotenv";
import {downloadNightlyTests} from "@lodestar/spec-test-util/downloadNightlyTests";
import {nightlyMarkerFile} from "@lodestar/spec-test-util/fixtures";

const [date = "latest", repo, branch] = process.argv.slice(2);
config({path: path.join(import.meta.dirname, "../../../../.env")});

const version = await downloadNightlyTests(
  {
    specTestsRepoUrl: repo ? `https://github.com/${repo}` : "https://github.com/ethereum/consensus-specs",
    testsToDownload: ["general", "mainnet", "minimal"],
    ...(branch && {branch}),
  },
  console.log,
  date
).catch((e: Error) => {
  console.error(e);
  process.exit(1);
});

fs.writeFileSync(nightlyMarkerFile, `${version}\n`);
console.log(
  `Consensus spec tests now use ${version}. Run 'zig build run:download_spec_tests' to return to the pinned release.`
);
