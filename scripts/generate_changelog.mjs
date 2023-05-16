/* eslint-disable
@typescript-eslint/no-var-requires,
@typescript-eslint/no-require-imports,
@typescript-eslint/no-unsafe-assignment,
@typescript-eslint/explicit-function-return-type,
no-console
*/

import {execSync} from "node:child_process";
import fs from "node:fs";

// Docs
// [script] <fromTag> <toTag>
//
// Example
// ```
// node scripts/generate_changelog.mjs v0.32.0 v0.33.0
// ```

/**
 * Prevent recurring curls for known authors
 * @type {Record<string, string>}
 */
const knownAuthors = {
  "caymannava@gmail.com": "wemeetagain",
  "develop@g11tech.io": "g11tech",
  "tuyen@chainsafe.io": "tuyennhv",
  "35266934+dapplion@users.noreply.github.com": "dapplion",
  "41898282+github-actions[bot]@users.noreply.github.com": "github-actions[bot]",
  "49699333+dependabot[bot]@users.noreply.github.com": "dependabot[bot]",
  "iulian@rotaru.fr": "mortimr",
  "filipesilvamedeiros@gmail.com": "filipesmedeiros",
  "etan@status.im": "etan-status",
  "git-sgmoore@users.noreply.github.com": "git-sgmoore",
  "58080811+philknows@users.noreply.github.com": "philknows",
  "58883403+q9f@users.noreply.github.com": "q9f",
  "fredrik@ethereum.org": "fredriksvantes",
  "mpetrunic@users.noreply.github.com": "mpetrunic",
  "ammar1lakho@gmail.com": "ammarlakho",
  "dadepo@gmail.com": "dadepo",
  "hi@enriqueortiz.dev": "Evalir",
  "nflaig@protonmail.com": "nflaig",
  "nazarhussain@gmail.com": "nazarhussain",
  "me@matthewkeil.com": "matthewkeil",
};

const fromTag = process.argv[2];
const toTag = process.argv[3];
const outpath = process.argv[4];

if (!fromTag) throw Error("No process.argv[2]");
if (!toTag) throw Error("No process.argv[3]");
if (!outpath) throw Error("No process.argv[4]");

/**
 * @type {Record<string, {heading: string; commitsByScope: Record<string, string[]>}>}
 */
const sections = {
  feat: {heading: "Features", commitsByScope: {"": []}},
  fix: {heading: "Bug Fixes", commitsByScope: {"": []}},
  perf: {heading: "Performance", commitsByScope: {"": []}},
  refactor: {heading: "Refactoring", commitsByScope: {"": []}},
  revert: {heading: "Reverts", commitsByScope: {"": []}},
  deps: {heading: "Dependencies", commitsByScope: {"": []}},
  build: {heading: "Build System", commitsByScope: {"": []}},
  ci: {heading: "Continuous Integration", commitsByScope: {"": []}},
  test: {heading: "Tests", commitsByScope: {"": []}},
  style: {heading: "Styles", commitsByScope: {"": []}},
  chore: {heading: "Maintenance", commitsByScope: {"": []}},
  docs: {heading: "Documentation", commitsByScope: {"": []}},
  _: {heading: "Miscellaneous", commitsByScope: {"": []}},
};

const isPrCommitRg = /\(#\d+\)/;
const conventionalCommitRg = /^([a-z]+)(?:\((.*)\))?(?:(!))?: (.*)$/;

const commitHashes = shell(`git log --pretty=format:"%H" ${fromTag}...${toTag}`);

for (const commitHash of commitHashes.trim().split("\n")) {
  const rawCommit = shell(`git log --format='%s' ${commitHash}^!`);

  if (!isPrCommitRg.test(rawCommit)) {
    console.log(`Ignored commit "${rawCommit}" (missing PR reference)`);
    continue;
  }

  const conventionalCommit = rawCommit.match(conventionalCommitRg);
  if (!conventionalCommit) {
    console.log(`Ignored commit "${rawCommit}" (not conventional commit)`);
    continue;
  }

  const [, type, scope, _breaking, subject] = conventionalCommit;

  const authorEmail = shell(`git log --format='%ae' ${commitHash}^!`);
  const authorName = shell(`git log --format='%an' ${commitHash}^!`);
  const login = getCommitAuthorLogin(commitHash, authorEmail, authorName);

  const formattedCommit = `- ${scope ? `**${scope}:** ` : ""}${subject} (@${login})\n`;

  // Sort commits by type and scope
  // - assign each commit to section based on type
  // - group commits by scope within each section
  if (sections[type] != null) {
    if (scope) {
      if (sections[type].commitsByScope[scope] == null) {
        sections[type].commitsByScope[scope] = [];
      }
      sections[type].commitsByScope[scope].push(formattedCommit);
    } else {
      sections[type].commitsByScope[""].push(formattedCommit);
    }
  } else {
    // Commits with a type that is not defined in sections
    sections._.commitsByScope[""].push(formattedCommit);
  }
}

// Print knownAuthors to update if necessary
console.log("knownAuthors", knownAuthors);

let changelog = `# Changelog

[Full Changelog](https://github.com/ChainSafe/lodestar/compare/${fromTag}...${toTag})
`;

// Write sections to changelog
for (const type in sections) {
  const section = sections[type];
  let hasCommits = false;
  let sectionChangelog = `\n### ${section.heading}\n\n`;

  for (const commits of Object.values(section.commitsByScope)) {
    if (commits.length > 0) {
      hasCommits = true;
      sectionChangelog += commits.join("");
    }
  }

  if (hasCommits) {
    // Only add section if it has at least one commit
    changelog += sectionChangelog;
  }
}

// Print to console
console.log(changelog);
// Persist to file
fs.writeFileSync(outpath, changelog);
// Done

/**
 * @param {string} cmd
 * @returns {string}
 */
function shell(cmd) {
  return execSync(cmd, {encoding: "utf8"}).trim();
}

/**
 *
 * @param {string} commitSha
 * @param {string} authorEmail
 * @param {string} authorName
 * @returns {string}
 */
function getCommitAuthorLogin(commitSha, authorEmail, authorName) {
  const knownAuthor = knownAuthors[authorEmail];
  if (knownAuthor) {
    return knownAuthor;
  }

  try {
    const res = shell(`curl https://api.github.com/repos/chainsafe/lodestar/commits/${commitSha}`);

    // "author": {
    //   "login": "dapplion",
    /**
     * @type {{author: {login: string}}}
     */
    const commit = JSON.parse(res);
    const login = commit.author.login;

    if (login) {
      knownAuthors[authorEmail] = login;
      console.log(`"${authorEmail}": "${login}"`);
      return login;
    } else {
      throw Error("login field is empty");
    }
  } catch (e) {
    console.error("Error fetching login", {commitSha, authorName}, e);
    return authorName;
  }
}
