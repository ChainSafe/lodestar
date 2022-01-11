# Lodestar Release Guidelines

![lodestar-release](docs/images/lodestar-releases.png)

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
If there is a bug discovered during the pre-release testing period which significantly impacts performance, security or stability, and it is determined that it is no longer prudent to release the `beta.x` candidate as `stable`, then it will await a bug fix by the team. The fix will be committed, back-ported to `master` and we publish and promote the new commit to `beta.x+1`. The 3 day testing period minimums will reset.

## Stable Releases
When the pre-release candidate (Example: `v0.33.0-beta.0`) has met the testing requirements, we execute `release.yml`. This script will promote & tag the candidate to the `stable` release track and remove `beta.x`, publishing the version as `v0.33.0`. 

The CI will check and tag the new stable release, publish to the NPM Registry and to Docker Hub.

## Minor/Patch Releases
The `minor` is increased as soon as new smaller features do get introduced. A minor release will not affect any depending project. Such a release only introduces smaller enhancements and features. A `patch` release only contains required bug fixes with a low risk to impact depending project.
