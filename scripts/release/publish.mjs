import {exitIf, help, resolveMonorepoDirpaths, shell} from "./utils.mjs";

const tag = process.argv[2];

help(`
Publish all packages in the monorepo

Usage:
  publish_all <tag>

See https://github.com/ChainSafe/lodestar/blob/unstable/RELEASE.md#1-create-release-candidate
`);
exitIf(!tag, "<tag> not set");

for (const dirpath of resolveMonorepoDirpaths()) {
  shell(`npm publish --tag ${tag}`, {cwd: dirpath});
}
