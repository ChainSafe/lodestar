/* eslint-disable no-console,
  @typescript-eslint/explicit-function-return-type,
  @typescript-eslint/no-var-requires,
  @typescript-eslint/no-require-imports */

// Script used in .github/workflows/release.yml to get the previous tag
// to generate a changelog from 'prev_tag' to 'tag'
// Returns the most recent tag that:
// - is not equal to CURRENT_TAG
// - does not contain IGNORE_PATTERN
//
// Outputs to output.prev_tag

const {exec} = require("node:child_process");
const {promisify} = require("node:util");

async function run() {
  const {CURRENT_TAG, IGNORE_PATTERN} = process.env;
  if (!CURRENT_TAG) throw Error("CURRENT_TAG must be defined");
  if (!IGNORE_PATTERN) throw Error("IGNORE_PATTERN must be defined");

  const {stdout} = await promisify(exec)("git tag --sort=-version:refname");
  // Returns sorted list of tags
  // v0.32.0
  // v0.31.0
  // v0.30.0
  // v0.29.3

  // Pick the first tag that doesn't match current tag
  const tags = stdout.trim().split("\n");
  for (const tag of tags) {
    if (tag !== CURRENT_TAG && !tag.includes(IGNORE_PATTERN)) {
      const cmd = `echo "prev_tag=${tag}" >> ${process.env.GITHUB_OUTPUT}`;
      console.log("Execute command on shell", cmd);
      await promisify(exec)(cmd);
      return;
    }
  }

  throw Error("No tag found");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
