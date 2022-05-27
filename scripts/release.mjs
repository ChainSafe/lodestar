import {execSync} from "node:child_process";
import {readFileSync} from "node:fs";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import inquirer from "inquirer";
import _lernaVersion from "@lerna/version";

// Script to make releasing easier
// Run with --help to see usage

const cmd = (cmd, opts={}) => execSync(cmd, {encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], ...opts}).trim();
const exit = (...msg) => { console.log(...msg), process.exit(1) };

const argv = yargs(hideBin(process.argv))
  .usage("Release lodestar")
  .example([
    ["$0 -t v0.36.0", "Release version 0.36.0 using the current commit"]
  ])
  .options({
    tag: {
      alias: "t",
      demandOption: true,
      type: "string",
      describe: "The tag to release",
    },
    commit: {
      alias: "c",
      type: "string",
      describe: "The commit to tag",
    },
    yes: {
      alias: "y",
      type: "boolean",
      describe: "Automatic yes to prompts"
    }
  })
  .version("v0.1.0")
  .alias("v", "version")
  .alias("h", "help")
  .strict()
  .help()
  .argv;

const yes = argv.yes;
const {
  tag,
  currentCommit,
  commit,
  commitMessage,
  branch,
} = getInfo(argv);

console.log("Tag", tag);
console.log("Checked-out commit", currentCommit);
console.log("Commit", commit, commitMessage);
console.log("Branch", branch);

ensureCommitExistsInBranch(commit, branch);

if (!lernaVersionMatchesTag(tag)) {
  console.log("Lerna-controlled version does not match tag");

  if (commit !== currentCommit) {
    exit("Cannot continue because the checked-out commit doesn't match the selected commit");
  }
  console.log("Deferring to lerna");
  await lernaVersion(tag, yes);
} else {
  await tagAndPush(commit, tag, yes);
}

console.log("Success!");

/////////////////////////////

function getInfo(argv) {
  // Validate tag version (must be semver-ish)
  const versionCaptureRegex=/^(v[0-9]+\.[0-9]+)\.[0-9]+(-rc\.[0-9]+)?$/
  const versionMatch = versionCaptureRegex.exec(argv.tag);
  if (versionMatch == null) {
    exit(`Tag must match ${versionCaptureRegex}`);
  }

  const tag = argv.tag;
  const currentCommit = cmd("git rev-parse --short HEAD");
  const commit = argv.commit ?? currentCommit;
  const commitMessage = cmd(`git show-branch --no-name ${commit}`);
  // The branch is assumed from the tag
  const branch = `${versionMatch[1]}.x`;

  return {
    tag,
    currentCommit,
    commit,
    commitMessage,
    branch,
  };
}

function ensureCommitExistsInBranch(commit, branch) {
  // Ensure the branch exists
  try {
    cmd(`git show-branch --no-name ${branch}`);
  } catch (e) {
    exit(`Branch ${branch} does not exist`);
  }

  // Ensure the commit exists in the branch (last 10 commits)
  const last10Commits = cmd(`git log --oneline -n 10 ${branch}`);
  const commitMatch = last10Commits.match(commit);
  if (commitMatch == null) {
    exit(`Commit ${commit} does not belong to branch ${branch}`);
  }
}

function lernaVersionMatchesTag(tag) {
  // Ensure the lerna.json is at the right version
  let lernaVersion;
  try {
    lernaVersion = JSON.parse(readFileSync("./lerna.json")).version;
  } catch (e) {
    exit(`Error fetching/parsing lerna.json: ${e.message}`);
  }
  return lernaVersion === tag;
}

async function lernaVersion(tag, yes) {
  try {
    await _lernaVersion({
      cwd: process.cwd(),
      bump: tag,
      "force-publish": true,
      yes: yes,
    })
  } catch (e) {
    exit((e.message));
  }
}

async function tagAndPush(commit, tag, yes)  {
  // Last chance to exit
  if (!yes) {
    const input = await inquirer.prompt([
      {
        name: "yes",
        type: "confirm",
        message: "Do you want to proceed? Continuing will tag and push.",
      },
    ]);
    if (!input.yes) {
      process.exit(1);
    }
  }

  // Perform release actions
  try {
    const tagCmd = `git tag -a ${tag} ${commit} -m "${tag}"`;
    console.log(tagCmd);
    cmd(tagCmd, {stdio: "pipe"});

    const pushCmd = `git push origin ${tag}`;
    console.log(pushCmd);
    cmd(pushCmd, {stdio: "pipe"});
  } catch (e) {
    exit(e.message);
  }
}
