# Lodestar Release Guidelines

Lodestar is blockchain node securing the Ethereum Beacon chain network. It is run by external individuals and operator entities outside of the control of the Lodestar team. We, as most other core dev teams, choose a slow conservative approach to releasing to ensure that node runners always update to stable, safe and performant versions of our software.

Gitflow is a well-known strategy that suits our needs for security and stability.

![lodestar-release](docs/images/gitflow-lodestar.png)

## Stable release

### When to a release

Lodestar does not have a fixed schedule for releases. Instead, they are published as the developers see fit.

The causes for a release are varied, however here are several common ones:

- To include a major bug-fix, optimisation or feature.
- To include a series of small changes which have shown to improve performance, usability, etc.
- If significant or risky PRs are waiting to merge and we wish to try and isolate those changes to a future release. I.e., to leave a "clean slate" for future PRs to apply to.

To start a new release, one of the Lodestar developers will communicate this via the Lodestar chat channel and seek consensus from the other developers.

**0. How to do feature branches**

- Create branch from latest develop
- Once in a review-able state, open PR against develop

### 1. Create release candidate

TLDR;

```
yarn release-candidate v0.1.0-beta.0 9fceb02
```

else, manual steps (as example version `v0.1.0`, commit `9fceb02`):

- The team selects a commit from `unstable` as a "release candidate" for a new version release.
- Create a new release branch `v0.1.0` at commit `9fceb02`.
- Set monorepo version to `v0.1.0-rc.0`.
- Commit changes with message `Bump to v0.1.0-rc.0`.
- Tag resulting commit to `v0.1.0-rc.0`, push commit and tag.
- Draft a Github release for the `v0.1.0-rc.0` marked as "Pre-release".
- Open PR from `v0.1.0` to `stable` with title `v0.1.0 release` and empty body (**TBH**).

### 2. Test release candidate

After 3-5 days of testing, is performance equal or better than latest stable?

- **Yes**: Continue to next release step
- **No**: If it a small issue fixable quickly (hot-fix)?
  - **Yes**: push a commit to branch `v0.1.0` and re-start testing process with `v0.1.0-beta.1`.
  - **No**: abort the release. Close the `v0.1.0 release` PR, delete branch, tag and release.

_LEFTOVERS_

If there is a bug discovered during the pre-release testing period which significantly impacts performance, security or stability, and it is determined that it is no longer prudent to release the `beta.x` candidate as `stable`, then it will await a bug fix by the team. The fix will be committed, back-ported to `master` and we publish and promote the new commit to `beta.x+1`. The 3 day testing period minimums will reset.

### 3. Merge release candidate

TLDR;

```
yarn release-stable v0.1.0
```

else, manual steps (as example version `v0.1.0`):

- Assert there is consensus head commit in branch `v0.1.0` is sufficiently stable
- Set monorepo version to `v0.1.0`.
- Commit changes with message `Bump to v0.1.0`.
- Merge `v0.1.0 release` PR to stable (with "merge commit" strategy to preserve all history, **TBD**).
- Tag resulting merge commit to `v0.1.0`, push commit and tag.
- Merge stable into unstable. If a direct merge is possible (no-conflicts) do that immediately. Otherwise, open a PR.
- Draft a Github release for the `v0.1.0`, ensure it gets the "latest" tag.
- Publish to Social Media

## Hot-fix release

If a stable version requires an immediate hot-fix before the next minor or major release:

- Create a release branch `v0.1.1` from master at that version tag.
- Commit the hot-fix to the `v0.1.1` branch and port to develop.
- Perform last steps of the stable release process:
  - _2. Test release candidate_: adjusting the length to the urgency and severity of the fix
  - _3. Merge release candidate_: command `release-stable` can be re-used for hot-fix releases.

## Nightly release

On every commit to develop a nightly / develop release is done automatically in CI. A nightly release:

- is not tagged
- does not have a release page
- is published to NPM
- is pushed to Dockerhub

The source code is mutated before release to set a version string of format `v0.1.0-dev.da9f72360`, where the appended hash is the merge commit hash to master that triggered this CI build. The semver version that prefixes it is mostly irrelevant in practical terms. The target consumers of such versions are automatic testing environments and other developers. They are expected to install via `dev` or `next` tags and refer to the whole version for debugging.

### Details

**Release CI reference**

- Trigger release on tag to stable. But in CI check that: tag matches version in source + commit is latest in branch. This prevents bad rogue versions and errors

**How to set monorepo version**

```
lerna version minor --no-git-tag-version --force-publish --yes
```

**How to draft releases**

TBD

**How to distribute a release**

Automatic scripts in Github actions publish:

- to NPM registry
- to Dockerhub

**How to test release candidates**

We test the pre-release candidate on multiple servers with a variance of connected validators on a stable testnet for a minimum of three (3) days.

The following observations must be taken into consideration before promoting the pre-release candidate to a `:stable` release:

- Are there any critical issues observed?
  - Examples: Memory leaks, abnormally high memory usage, abnormally high CPU performance, etc.
- Has profitability been affected?
  - Has profitability decreased and whether or not the variance is acceptable.
- Has any performance metric degraded comparably to the previous `stable` release? If yes, is the variance acceptable?
  - Example: Block processing times, validator miss ratios, etc.

**Edit the Release**

Review the checklists, ensure they are completed and then delete them, so they don't appear in the final release notes.

Get list of commits to `stable` for the "All Changes" section with:

```
git log --graph --pretty=format:'%s' --abbrev-commit
```

This will print a list of commits (each a squash-merged PR). Copy-paste all the commits between this release and the last release into the release notes. See previous releases for examples.

Check the automatically generated Docker links to ensure that other CI runs have updated the relevant tags.

The release notes should be professional, comprehensive and well considered.

Have someone else review the release notes and then publish the release.

**Publish to Social Media**

The release should be announced on the following social channels:

- Email: with mailchimp.
- Discord: Use the #announcements channel. Tag @everyone and ensure it is published to all downstream channels.
- Twitter: Short and sweet in a single tweet, **TBD** get lodestar account.
- Reddit: **TBD** get lodestar account.

## Alternatives considered

Historical context and reasons against valid alternatives to help future discussions

**Master as single target**

Lodestar used master as the single target for feature branches.

![lodestar-release](docs/images/lodestar-releases.png)

- Main branch = master
- Features merged to master
- To trigger rc, branch from master to v0.1.x
- QA is done on v0.1.x branch
- Fixes on rc are done on v0.1.x, then re-tag
- Once released final v0.1.0 tag is on a branch that is never merged
- Hot-fixes are done on new or existing v0.36.x branch, never merged

However this had some issues:

- Aborted releases left master in awkward version 2 minors ahead of stable. When triggering the release again, we had to rollback master
- Almost all release tags ended in branches not part of the master tree. This caused issues and confusing in tooling since it's not straightforward to compute the diff between commits that are not direct parents of each other

**Continuous integration**

Another popular approach used by some entities but unsuitable for Lodestar. Given the complexity of a blockchain node, it's not possible to guarantee stable performance unless running the software for days in special conditions, not available in regular CI environments.
