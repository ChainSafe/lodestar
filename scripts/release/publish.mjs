import fs from "node:fs";
import path from "node:path";
import {exitIf, help, shell} from "./utils.mjs";

// TODO: Allow to customize
const workspacesPath = "./packages";

const tag = process.argv[2];

help(`
Publish all packages in the monorepo

Usage:
  publish_all <tag>

See https://github.com/ChainSafe/lodestar/blob/unstable/RELEASE.md#1-create-release-candidate
`);
exitIf(!tag, "<tag> not set");

for (const dirname of fs.readdirSync(workspacesPath)) {
  const dirpath = path.join(workspacesPath, dirname);
  const pkgPath = path.join(dirpath, "package.json");
  if (fs.existsSync(pkgPath)) {
    shell(`npm publish --tag ${tag}`, {cwd: dirpath});
  }
}
