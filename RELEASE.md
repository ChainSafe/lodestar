# Lodestar Release Guidelines

Lodestar is a blockchain node securing the Ethereum Beacon chain network. It is run by external individuals and operator entities outside of the control of the Lodestar team. We, as most other core dev teams, choose a slow conservative approach to releasing to ensure those node runners always update to stable, safe, and performant versions of our software.

Lodestar uses a modified version of gitflow to manage releases. [Gitflow](https://www.atlassian.com/git/tutorials/comparing-workflows/gitflow-workflow) is a well-known strategy that suits our needs for security and stability.

## Stable release

### When to a release

Lodestar does not have a fixed schedule for releases. Instead, they are published as the developers see fit.

The causes for a release are varied, however here are several common ones:

- To include a major bug-fix, optimization, or feature.
- To include a series of small changes which have shown to improve performance, usability, etc.
- If significant or risky PRs are waiting to merge and we wish to try and isolate those changes to a future release. I.e., to leave a "clean slate" for future PRs to apply to.
- An external team or entity needs a specific feature that the team has agreed to publish.

To start a new release, one of the Lodestar developers will communicate this via the Lodestar chat channel and seek consensus from the other developers.

### 1. Create release candidate

#### All-in-one script (for example version `v1.1.0`, commit `9fceb02`):

- The team selects a commit from `unstable` as a "release candidate" for a new version release.
  - NOTE: In some rare circumstances, the team may select a commit from `stable`. This may happen if a tight deadline needs to be met and `unstable` can't be stabilized in time. We should avoid doing this unless absolutely necessary as merge conflicts and unintended consequences of cherry-picking commits may arise.
- `yarn release:create-rc 1.1.0 9fceb02`
  - Must be run locally from a write-access account capable of triggering CI.
  - This script may alternatively be run on the checked out `HEAD`:
    - `git checkout 9fceb02`
    - `yarn release:create-rc 1.1.0`
- Open draft PR from `rc/v1.1.0` to `stable` with title `chore: v1.1.0 release`.

#### Manual steps (for example version `v1.1.0`, commit `9fceb02`):

- The team selects a commit from `unstable` as a "release candidate" for a new version release.
- Create a new release branch `rc/v1.1.0` at commit `9fceb02`.
  - `git checkout -b rc/v1.1.0 9fceb02`
- Set monorepo version to `v1.1.0`.
  - `lerna version v1.1.0 --no-git-tag-version --force-publish --yes`
- Commit changes
  - `git commit -am "v1.1.0"`
  - `git push origin rc/v1.1.0`
- Open draft PR from `rc/v1.1.0` to `stable` with title `chore: v1.1.0 release`.

### 2. Tag release candidate

Tagging a release candidate will trigger CI to publish to NPM, dockerhub, and Github releases.

#### All-in-one script (for example version `v1.1.0`, commit `8ab7cef`):

- The team selects a commit from `rc/v1.1.0` as a commit to tag and publish.
- `yarn release:tag-rc 1.1.0 8ab7cef`
  - Must be run locally from a write-access account capable of triggering CI.
  - This script may alternatively be run on the checked out `HEAD`:
    - `git checkout 8ab7cef`
    - `yarn release:tag-rc 1.1.0`

#### Manual steps (for example version `v1.1.0`, commit `8ab7cef`):

- Check out the commit:
  - `git checkout 8ab7cef`
- Tag resulting commit as `v1.1.0-rc.0` with an annotated tag, and push the tag.
  - `git tag -am "v1.1.0-rc.0" v1.1.0-rc.0`
  - `git push origin v1.1.0-rc.0`

### 3. Test release candidate

Once a release candidate is created, the Lodestar team begins a testing period.

If there is a bug discovered during the testing period which significantly impacts performance, security, or stability, and it is determined that it is no longer prudent to promote the `rc.x` candidate to `stable`, then it will await a bug fix by the team. The fix will be committed to `unstable` first, then cherrypicked into the `rc/v1.1.0` branch. Then we publish and promote the new commit to `rc.x+1`. The 3-day testing period will reset.

For example: After 3-5 days of testing, is performance equal to or better than latest stable?

- **Yes**: Continue to the next release step
- **No**: If it a small issue fixable quickly (hotfix)?
  - **Yes**: Merge fix(es) to `unstable`, push the fix(es) to `rc/v1.1.0` branch, go to step 2, incrementing the rc version
  - **No**: abort the release. Close the `chore: v1.1.0 release` PR, delete the branch, and start the whole release process over.

### 4. Merge release candidate

- Ensure step 2 testing is successful and there is sufficient consensus to release `v1.1.0`.
- Approving the `chore: v1.1.0 release` PR means a team member marks the release as safe, after personally reviewing and / or testing it.
- Merge `chore: v1.1.0 release` PR to stable **with "merge commit"** strategy to preserve all history.
- Merge stable `stable` into `unstable` **with merge commit** strategy. Due to branch protections in `unstable` must open a PR. If there are conflicts, those must be resolved manually. Gitflow may cause changes that conflict between stable and unstable, for example due to a hotfix that is backported. If that happens, disable branch protections in unstable, merge locally fixing conflicts, run lint + tests, push, and re-enable branch protections.

### 5. Tag stable release

Tagging a stable release will trigger CI to publish to NPM, dockerhub, and Github releases.

#### All-in-one script (for example version `v1.1.0`):

- `git checkout stable`
- `yarn release:tag-stable 1.1.0`
  - Must be run locally from a write-access account capable of triggering CI.

#### Manual steps (for example version `v1.1.0`):

- Check out the new stable
  - `git checkout stable`
- Tag it as `v1.1.0` with an annotated tag, push commit and tag.
  - `git tag -am "v1.1.0" v1.1.0`
  - `git push origin v1.1.0`

### 6. Announce

- Double check that Github release is correct
- Follow [Publish to Social Media](#publish-to-social-media) steps

## Hotfix release

If a stable version requires an immediate fix before the next release, a hotfix release is started.

A similar process for a stable release is used, with the three differences.

- The candidate commit must be chosen from the `stable` branch instead of the `unstable` branch.
- Depending on the severity of the bug being fixed, the testing window may be decreased.
- All hotfixes are committed with an `unstable` first strategy rather than directly on the RC branch itself. Hotfixes are always merged to `unstable` first, then cherry-picked into hotfix release candidates.

### 1. Create hotfix release candidate from `stable` branch

#### All-in-one script (for example version `v1.1.1`, stable commit `8eb8dce`):

- Select the latest commit from `stable` as the "hotfix release candidate" for a new hotfix version release.
- `git fetch origin stable`
- `git checkout stable`
- `yarn release:create-rc 1.1.1`
  - Must be run locally from a write-access account capable of triggering CI.
- Switch to the hotfix release branch and cherrypick the inclusion(s) from the `unstable` branch to the hotfix release.
  - `git checkout rc/v1.1.1`
  - `git cherry-pick {commit}`
- Open draft PR from `rc/v1.1.1` to `stable` with the title `chore: v1.1.1 release`.

#### Manual steps (for example version `v1.1.1`, commit `8eb8dce`):

- Select the latest commit from `stable` as the "hotfix release candidate" for a new hotfix release.
- Checkout `stable` branch
  - `git checkout stable`
- Create a new release branch `rc/v1.1.1` at commit `8eb8dce`
  - `git checkout -b rc/v1.1.1 8eb8dce`
- Set monorepo version to `v.1.1.1`.
  - `lerna version v1.1.1 --no-git-tag-version --force-publish --yes`
- Commit changes
  - `git commit -am "v1.1.1"`
  - `git push origin rc/v1.1.1`
    Open draft PR from `rc/v1.1.1` to `stable` with the title `chore: v1.1.1 release`.

### 2. Tag release candidate

Tagging a release candidate will trigger CI to publish to NPM, dockerhub, and Github releases.

#### All-in-one script (for example version `v1.1.1`, commit `f3df9f8`):

- Select the latest commit from `rc/v1.1.1` to tag and publish.
- `yarn release:tag-rc 1.1.1`
  - Must be run locally from a write-access account capable of triggering CI.

#### Manual steps (for example version `v1.1.1`, commit `f3df9f8`):

- Tag latest commit as `v1.1.1-rc.0` with an annotated tag, and push the tag.
  - `git tag -am "v1.1.1-rc.0" v1.1.1-rc.0`
  - `git push origin v1.1.1-rc.0`

### 3. Test hotfix release candidate

Once a hotfix release candidate is created, the Lodestar team may begin a modified hotfix testing period consisting of a quick sanity check or longer if required.

If the hotfix does not address the purpose of the hotfix release, or there is another bug discovered during this modified hotfix testing period which significantly impacts performance, security, or stability, and it is determined that it is no longer prudent to promote the `rc.x` candidate to `stable`, then it will await an additional fix by the team. The fix will be committed to `unstable` first, then cherrypicked into the `rc/v1.1.1` hotfix branch. Then we publish and promote the new commit to `rc.x+1`. The modified hotfix testing period will reset.

For example: After modified hotfix testing period, is the original bug resolved? Is performance equal to or better than latest stable?

- **Yes**: Continue to the next release step
- **No**: If it a small issue fixable quickly with another hotfix?
  - **Yes**: Merge fix(es) to `unstable`, push the fix(es) to `rc/v1.1.1` hotfix branch, go to step 2, incrementing the rc version
  - **No**: Abort the release. Close the `chore: v1.1.v release` PR, delete the branch, and start the whole release process over.

### 4. Merge hotfix release candidate

- Ensure step 3 testing is successful and there is sufficient consensus to release `v1.1.1`.
- Approving the `chore: v1.1.1 release` PR means a team member marks the release as safe, after personally reviewing and / or testing it.
- Merge `chore: v1.1.1 release` PR to stable **with "merge commit"** strategy to preserve all history.
- Merge `stable` into `unstable` **with merge commit** strategy. Due to branch protections in `unstable` must open a PR. If there are conflicts, those must be resolved manually. Gitflow may cause changes that conflict between stable and unstable, for example due to a hotfix that is backported. If that happens, disable branch protections in unstable, merge locally fixing conflicts, run lint + tests, push, and re-enable branch protections. See "Backporting merge conflicts from stable to unstable".

Pull the latest commits on both `stable` and `unstable` branches:

- `git checkout stable && git pull origin stable`
- `git checkout unstable && git pull origin unstable`

Merge `stable` into `unstable`, resolving conflicts:

- `git checkout unstable && git merge stable`
- Resolve conflicts
- Sanity check locally before pushing by using: `git diff origin/unstable unstable`
- Disable `unstable` branch protection
- `git push`
- Enable `unstable` branch protection

### 5. Tag stable hotfix release

Tagging a stable release will trigger CI to publish to NPM, dockerhub, and Github releases.

#### All-in-one script (for example version `v1.1.1`):

- `git checkout stable`
- `yarn release:tag-stable 1.1.1`
  - Must be run locally from a write-access account capable of triggering CI.

#### Manual steps (for example version `v1.1.1`):

- Check out the new stable
  - `git checkout stable`
- Tag it as `v1.1.1` with an annotated tag, push commit and tag.
  - `git tag -am "v1.1.1" v1.1.1`
  - `git push origin v1.1.1`

### 6. Announce

- Double check that Github release is correct
- Follow [Publish to Social Media](#publish-to-social-media) steps

## Dev release

On every commit to `unstable` a dev release is done automatically in CI. A dev release:

- is not tagged
- does not have a release page
- is published to NPM
- is pushed to Dockerhub

The source code is mutated before release to set a version string of format `v1.1.0-dev.da9f72360`, where the appended hash is the merge commit hash to `unstable` that triggered this CI build. The semver version that prefixes is expected to be the next minor version from the current code. The target consumers of such versions are automatic testing environments and other developers. They are expected to install via `next` tags and refer to the whole version for debugging.

## Details

### Publishing a release

The publishing of stable releases and release candidates is triggered by pushing a tag.

CI ensures the validity of the stable release and releases candidates by checking:

- the tag matches the version in the source
- for stable releases, the commit is the latest in the `stable` branch

This prevents accidentally publishing an incorrect version of Lodestar.

Dev releases are triggered on every new push to `unstable`.

Github workflows publish:

- to NPM registry
- to Dockerhub
- to Github releases

The behavior differs based on whether a stable release, a release candidate, or dev release is being performed.

- Stable release
  - published to npm with `latest` dist tag
  - published to docker with `latest` tag
  - a full Github release is published
- Release candidate
  - published to npm with `rc` dist tag
  - published to docker with `rc` tag
  - a prerelease Github release is published
- Dev release
  - published to npm with `next` dist tag
  - published to docker with `next` tag
  - no Github release is published

### How to test release candidates

We test the pre-release candidate on multiple servers with a variety of connected validators on a stable testnet for a minimum of three (3) days.

The following observations must be taken into consideration before promoting the release candidate to `stable`:

- Are there any critical issues observed?
  - Examples: Memory leaks, abnormally high memory usage, abnormally high CPU performance, etc.
- Has profitability been affected?
  - Has profitability decreased and whether or not the variance is acceptable.
- Has any performance metric degraded comparably to the previous `stable` release? If yes, is the variance acceptable?
  - Example: Block processing times, validator miss ratios, etc.

### Edit the Release

Releases are published automatically via CI.

Any additional release notes should be professional, comprehensive, and well-considered.

Have someone else review the release notes and then edit the release.

### Publish to Social Media

The release should be announced on the following social channels:

- Discord: Use the #lodestar-announcements channel. Ensure it is published to all downstream channels
- Twitter: Short and sweet in a single tweet or thread with twitter.com/lodestar_eth
- Blog post (if necessary): To outline specific changes that require additional context for users

# Release Manager Checklist

This section is to guide the Release Manager tasked with the next version release to ensure all items have been completed.

- Start thread on communication channels for new release
- Confirm consensus on `unstable` release candidate commit
- Complete Step 1: Create release candidate
- Complete Step 2: Tag release candidate
- Deploy `rc.x` candidate to `beta` group of servers
- If there are `rc.x` hot fixes, push to branch and increment the `rc.x` version.
- Team members conduct Release Candidate Metrics Review
- A Lodestar team member must mark the release candidate as safe, after personally reviewing and / or testing it
- Backup `stable` and `unstable` branches locally for restoration in case of accidental use of the incorrect merge method
- Temporarily enable "Allow merge commits" under the Lodestar repository settings
- Release Manager can now complete Step 4: Merge release candidate.
- Disable "Allow merge commits" under the Lodestar repository settings
- Complete Step 5: Tag stable release
- Double check that Github release is correct and inform the Project Manager of completion
- Project Manager to follow up with Devops updating both `bn` and `vc` stable servers

## Alternatives considered

<details>
  <summary>Click to expand!</summary>

Historical context and reasons against valid alternatives to help future discussions

**Version branches**

Lodestar used `master` as the single target for feature branches.

![lodestar-release](docs/static/images/lodestar-releases.png)

- Main branch = `master`
- Features merged to `master`
- To trigger rc, branch from `master` to `v1.1.x`
- `master` had package.json preemptively updated to the "next" version
- QA is done on `v1.1.x` branch
- Fixes on rc are done on `v1.1.x`, then re-tag
- Once released final `v1.1.0` tag is on a branch that is never merged
- Hotfixes are either cherry-picked from `master` or done on the `v1.1.x` branch, never merged

However, this had some issues:

- Aborted releases left master in awkward version 2 minors ahead of `master`. When triggering the release again, we had to rollback `master`
- Almost all release tags ended in branches not part of the master tree. This caused issues since it's not straightforward to compute the diff between commits that are not direct parents of each other

**Continuous integration**

Always releasing `master` is another popular approach used by some entities but unsuitable for Lodestar. Given the complexity of a blockchain node, it's not possible to guarantee stable performance unless running the software for days under special conditions, not available in regular CI environments.

</details>
