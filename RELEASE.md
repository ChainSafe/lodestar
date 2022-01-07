# Lodestar Release Guidelines

![lodestar-release](https://user-images.githubusercontent.com/58080811/148576989-0e6924f5-8b5a-48c8-baa5-8a833cc364b0.png)

## Release Process Rules

1. The team selects a commit from `master` as a "stable target" for a new version release.
2. The selected commit is branched into a separate release branch (Example: `v0.33.x`) 
3. The commit on the separate release branch is tagged with `beta.x`. (Example: `v0.33.0-beta.0`) and published for testing as a pre-release.
4. The team bumps `master` to the next version and continues releasing nightly builds. (Example: `v0.34.0`)

## Pre-Releases
A `beta.x` release gets published and tagged when the team selects a commit as a "stable target" candidate.

### Pre-Release Testing Checklist
We test the pre-release candidate on multiple servers with a variance of connected validators on a stable testnet for a minimum of three (3) days. 

The following observations must be taken into consideration before promoting the pre-release candidate to a `:stable` release:

- Are there any critical issues observed?
    - Examples: Memory leaks, abnormally high memory usage, abnormally high CPU performance, etc. 

- Has profitibility been affected?
    - Has profitability decreased and whether or not the variance is acceptable.

- Has any performance metric degraded comparably to the previous `stable` release? If yes, is the variance acceptable?
    - Example: Block processing times, validator miss ratios, etc.

### Bug fixes to Pre-Releases
We commit bug fixes exclusively to the specific pre-release candidate and preserve separation from `master` such that we can keep merging unstable PRs to`master`. If a fix is committed, we publish and promote the candidate to `beta.x+1`.

## Stable Release
When pre-release candidates have met the testing requirements, we execute `release.yml`.

The CI will check and tag the new stable release, publish to the NPM Registry and to Docker Hub.
