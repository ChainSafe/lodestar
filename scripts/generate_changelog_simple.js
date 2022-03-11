/* eslint-disable
@typescript-eslint/no-var-requires,
@typescript-eslint/no-require-imports,
@typescript-eslint/no-unsafe-assignment,
@typescript-eslint/explicit-function-return-type,
no-console
*/

const {execSync} = require("node:child_process");
const fs = require("node:fs");

// Docs
// [script] <fromTag> <toTag>
//
// Exmaple
// ```
// node scripts/changelog_simple.js v0.32.0 v0.33.0
// ```

/**
 * Prevent recurring curls for known authors
 * @type {Record<string, string>}
 */
const knownAuthors = {
  "caymannava@gmail.com": "wemeetagain",
  "76567250+g11tech@users.noreply.github.com": "g11tech",
  "vutuyen2636@gmail.com": "tuyennhv",
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
};

const fromTag = process.argv[2];
const toTag = process.argv[3];
const outpath = process.argv[4];

if (!fromTag) throw Error("No process.argv[2]");
if (!toTag) throw Error("No process.argv[3]");
if (!outpath) throw Error("No process.argv[4]");

const isPrCommitRg = /\(#\d+\)/;

const commitHashes = shell(`git log --pretty=format:"%H" ${fromTag}...${toTag}`);

let commitListStr = "";

for (const commitHash of commitHashes.trim().split("\n")) {
  const subject = shell(`git log --format='%s' ${commitHash}^!`);
  if (!isPrCommitRg.test(subject)) {
    continue;
  }

  const authorEmail = shell(`git log --format='%ae' ${commitHash}^!`);
  const authorName = shell(`git log --format='%an' ${commitHash}^!`);
  const login = getCommitAuthorLogin(commitHash, authorEmail, authorName);

  commitListStr += `- ${subject} (@${login})\n`;
}

// Print knownAuthors to update if necessary
console.log("knownAuthors", knownAuthors);

const changelog = `# Changelog

[Full Changelog](https://github.com/ChainSafe/lodestar/compare/${fromTag}...${toTag})

**Merged pull requests:**

${commitListStr}
`;

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
