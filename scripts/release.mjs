import {execSync} from "node:child_process";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import inquirer from "inquirer";

// Script to make releasing easier
// Run with --help to see usage

const cmd = (cmd, opts={}) => execSync(cmd, {encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], ...opts}).trim();

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
      default: cmd("git rev-parse --short HEAD"),
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

// Validate the supplied version
const versionCaptureRegex=/^(v[0-9]+\.[0-9]+)\.[0-9]+(-beta\.[0-9]+)?$/
const versionMatch = versionCaptureRegex.exec(argv.tag);
if (versionMatch == null) {
  console.log(`Tag must match ${versionCaptureRegex}`);
  process.exit(1);
}

const tag = argv.tag;
const commit = argv.commit;
const commitMessage = cmd(`git show-branch --no-name ${commit}`);
// The branch is assumed from the tag
const branch = `${versionMatch[1]}.x`;

console.log("Tag", tag)
console.log("Commit", commit, commitMessage)
console.log("Branch", branch)

// Ensure the branch exists
try {
  cmd(`git show-branch --no-name ${branch}`);
} catch (e) {
  console.log(`Branch ${branch} does not exist`);
  process.exit(1);
}

// Ensure the commit exists in the branch (last 10 commits)
const last10Commits = cmd(`git log --oneline -n 10 ${branch}`);
const commitMatch = last10Commits.match(commit);
if (commitMatch == null) {
  console.log(`Commit ${commit} does not belong to branch ${branch}`);
  process.exit(1);
}

// Last chance to exit
if (!argv.yes) {
  const input = await inquirer.prompt([
    {
      name: "yes",
      type: "confirm",
      message: "Do you want to proceed?",
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

  console.log("Success!");
} catch (e) {
  console.log(e.message);
  process.exit(1);
}
