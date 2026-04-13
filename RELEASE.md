# Lodestar Release Process

There are a few steps for creating a release and depending on the conditions of the release the process will follow one of the several available paths.

The key decision points are:

- Is the release a "stable" release or a "hotfix" patch release
- Does a release require a testing/soaking period for formal verification

Stable release process is a normal cadence release of features and generally follows a minor semver version change. A patch, or hotfix, release is a non-cadence fix that is done as a reaction to new information that is outside of the normal development process. Examples are critical bugs, security risks or other external factors like poor planning on behalf of an external party that necessitate immediate action. There is one other type of release, the `dev` release. This is strictly an automated process though.

Generally all code that gets released will follow The RC, Release Candidate, Selection Process which includes a period of testing. The RC process will apply to all stable releases and is a critical part of the stable release workflow. The RC process is optional for the hotfix process and conditional on the type of fix being applied and released. As an example, a simple configuration change like scheduling a fork will not need to be tested. A critical security bug that can compromise the network might not want to be "soaked" for several days leaving unpatched nodes vulnerable for an extended period. This is where team judgement comes in. How and when to test the code prior to release falls on the team, and the decision should not be made in isolation.

This document is broken into a few major sections

- [Dev Releases](#dev-release)
- [Stable Releases](#stable-releases-example-v1410)
- [Hotfix Releases](#hotfix-releases-example-v1411)
- [Testing a Release](#testing-a-release)
- [Merging a Release](#merging-a-release)
- [Tagging a Release](#tagging-a-release)
- [Announcing a Release](#announcing-a-release)

Before any of the steps below are followed, its best to create a thread on Discord to announce the process to the team. The thread should be part of the [#lodestar-developer](https://discord.com/channels/593655374469660673/1197575814494035968) Discord channel on the [ChainSafe server](https://discord.gg/Hmpw3psQ3U).

All of the branches of the release process will have "pushing a tag" as the last step before [announcing the release](#announcing-a-release). Pushing a tag to github will trigger a CI process and the workflow will publish:

- to NPM registry
- to Dockerhub
- to Github releases

The final result of the overall "Release Process" will be to create the following:

- Stable/Hotfix release
  - published to npm with `latest` dist tag
  - published to docker with `latest` tag
  - a full Github release is published
- Release candidate
  - published to npm with `rc` dist tag
  - published to docker with `rc` tag
  - a pre-release Github release is published
- Dev release
  - published to npm with `next` dist tag
  - published to docker with `next` tag

## `dev` Release

This is automatic and is really only worth noting here because it exists. Every commit that gets merged to `unstable`, ie a PR to the trunk, will be a "release" of code. But this is not really part of the "release process." Its more a function of publishing the code for external consumers and our own watchtower process that auto-updates our fleet.

Dev releases:

- get published to NPM
- get published to DockerHub
- are not tagged
- do not get a release page on GitHub

The release will follow semver and the version will be the next minor version that is expected, relative to the current code. So if the code is currently v1.40.0, then the dev release will be `v1.41.0-dev.da800855` where `da800855` is the sha of the squashed PR commit that got merged to `unstable` and triggered the build. This will also trigger the docker `next` tag to get updated to point to `v1.41.0-dev.da800855`.

## Stable Releases (example v1.41.0)

The Stable Release Process goes through the following steps

- [Creating a Stable Release Branch and PR](#creating-a-stable-release-branch-and-pr)
- [Testing the Release](#testing-a-release)
- [Merging a Release](#merging-a-release)
- [Tagging a Release](#tagging-a-release)
- [Announcing a Release](#announcing-a-release)

### Pre-Requisites for a stable release

- All code that will get released must already be merged to `unstable`

### Creating a Stable Release Branch and PR

```sh
> git checkout unstable # or using a target commit behind the HEAD `git checkout b00855`
> pnpm release:create-rc 1.41.0
> # Open the PR
```

Generally a release is cut from the HEAD of `unstable` but can be any `unstable` commit. The commands above will trigger a series of events and the overall flow is as follows:

- Checkout the commit that is targeted
- Create a branch `rc/v1.41.0`, from target, for the Release Candidate
- Update the package versions
- Push the branch
- Open a draft PR named `chore: v1.41.0 release` for `rc/v1.41.0` that targets `stable`

<details>
  <summary>
    Manual Steps
  </summary>

- `git checkout -b rc/v1.41.0 unstable` or `git checkout -b rc/v1.41.0 b00855`
- `lerna version v1.41.0 --no-git-tag-version --force-publish --yes`
- `git commit -am "v1.41.0"`
- `git push origin rc/v1.41.0`
- Open the PR

</details>

## Hotfix Releases (example v1.41.1)

Testing of a Hotfix Release is case-dependent and up to team consensus on whether its necessary or not. For simple config changes its not important. For critical security bugs it may not be desirable to wait for the full soaking process so the vulnerability window is smaller. This is where best judgment will be the guide. Consult the team for when to proceed to the rest of the process below.

The Hotfix Release Process goes through the following steps

- [Creating a Hotfix Release Branch and PR](#creating-a-hotfix-release-branch-and-pr)
- [OPTIONAL: Testing the Release](#testing-a-release)
- [Merging a Release](#merging-a-release)
- [Tagging a Release](#tagging-a-release)
- [Announcing a Release](#announcing-a-release)

### Pre-Requisites for Hotfix Release

- All changes must already be merged to `unstable`

### Creating a Hotfix Release Branch and PR

```sh
git checkout -b rc/v1.41.1 stable # can omit the `stable` if already have tip of `stable` checked out
pnpm release:create-rc 1.41.1
git cherry-pick ****** # see "Prepare the Hotfix" below
git push
```

A hotfix release is cut from the HEAD of `stable` because that represents the last stable release. We do not support backporting of fixes to older releases so we are always patching the tip of `stable`. The overall flow is as follows:

- Checkout `stable`
- Create a branch `rc/v1.41.1` from `stable` for the Release Candidate
- [Prepare the hotfix](#prepare-the-hotfix)
- Open a draft PR named `chore: v1.41.1 release` for `rc/v1.41.1` that targets `stable`

<details>
  <summary>
    Manual Steps
  </summary>

- `git checkout -b rc/v1.41.1 stable`
- `lerna version v1.41.1 --no-git-tag-version --force-publish --yes`
- `git commit -am "v1.41.1"`
- `git push origin rc/v1.41.1`

</details>

#### Prepare the Hotfix

Critically, the commits that are needed to fix a release MUST be squashed PR's that are already merged to `unstable`. This is critical to prevent `stable` and `unstable` from diverging. To prepare the hotfix, just cherry-pick the commits that are needed from `unstable` to `rc/v1.41.1`

## Testing a Release

Testing of a Release Candidate involves publishing an `-rc.X` version of the code and testing it for a period of time, usually 3 days. There is an iterative component to the process though. Often times the first, or could be fifth, candidate for release has a performance regression or feature issue. To resolve the issue another release candidate is created and tested. The high level process for testing a release candidate is to create an RC tag and that tag will kick off CI to publish the artifacts. Once the artifacts are published they are deployed to the `beta` group for a soaking period to develop the metrics and logs. This iterative process is done until the candidate is ready for formal release.

### Tagging an RC

Checkout the `rc/v1.XX.X` branch to get ready to tag. The following must be run from an account with write-access to push a tag.

Simply run `pnpm release:tag-rc 1.XX.X` where `1.XX.X` corresponds to the current release version (stable or hotfix both apply). The script will look for the most recent `-rc.x`, increment to the next version and then push the tag.

<details>
  <summary>
    Manual Steps
  </summary>

- Look on GitHub for the most recent version of the `-rc.x`. Assume for this example its `v1.41.0-rc.2`
- Mentally increment the RC to `-rc.3`
- `git tag -am "v1.41.0-rc.3" v1.41.0-rc.3`
- `git push origin v1.41.0-rc.3`

</details>

### Testing the Tagged RC

The RC is allowed to soak on the `beta` group for around 3 days. During the soaking period, finding regressions in the logs or metrics is common. If a bug is discovered that significantly impacts performance, security, or stability a fix will be generated and a PR for the fix will be made against `unstable`. Once the fix PR is merged to `unstable` the PR commit is cherry-picked to the `rc/v1.XX.X` branch and the [tagging an RC](#tagging-an-rc) process is followed to publish the code. The newly tagged RC version is deployed to `beta` and the soaking period starts again.

## Merging a Release

The critical piece of this process is using a merge commit to preserve the git history for all the PR's that were merged into `unstable`. You must have admin privileges to go through this process.

- Approval of the release PR when ready for release
- Notifying the team that merge commits are enabled in [#lodestar-private](https://discord.com/channels/593655374469660673/605818244036821012) with "🚨 Merge Commits Enabled 🚨"
- Go to the [GitHub setting for Lodestar](https://github.com/ChainSafe/lodestar/settings) and turn on "Allow merge commits" with the "Pull request title and description" setting
- Merge the `chore: v1.XX.X release` PR into `stable` using a **_merge commit_**
- Merge `stable` back into `unstable` using a **_merge commit_**
- Notifying the team that merge commits are disabled in [#lodestar-private](https://discord.com/channels/593655374469660673/605818244036821012) with "✅ Merge Commits Disabled ✅"

Note that generally, the merging of `stable` back into `unstable` should show a diff of only two commits, the version upgrade commits where all of the package versions get bumped and the merge commit itself for the rc-branch PR.

If there was any cherry-picking involved in the process of creating the release branch, then the cherry-pick process can potentially introduce merge conflicts when back merging. In practice this is rare but its worth noting the process to fix things.

- `git checkout stable`
- `git pull`
- `git checkout unstable`
- `git pull`
- `git merge stable`
- Manually resolve merge conflicts
- Run `lint`, `test` and all other repo maintenance commands to verify that the merge conflicts were fixed correctly
- Sanity check locally before pushing by using: `git diff origin/unstable unstable`
- Disable `unstable` branch protection
- `git push`
- Enable `unstable` branch protection

## Tagging a Release

The tagging process is the final step for actually getting the code out into the world. CI handles the full process and all that is necessary is to push a tag to GitHub.

There are two methods for tagging a Stable Release. The script runs some additional checks to make sure that there are not any edge conditions that will cause a failed release. Both methods must be run from a write-access account that can push a tag.

- [All-in-one script](#all-in-one-script)
- [Manually tagging](#manually-tagging) (not recommended)

### All-In-One Script

- `git checkout stable`
- `pnpm release:tag-stable 1.41.0`

<details>
  <summary>
    Manual Steps
  </summary>

### Manually Tagging

- `git checkout stable`
- `git pull` after merging the release PR
- `git tag -am "v1.41.0" v1.41.0`
- `git push origin v1.41.0`

</details>

## Announcing a Release

Once the release, stable or hotfix, is tagged and available on github, dockerhub and npm its time to announce the release to the community. When a release is tagged and built there will be a roughed-out changelog that is auto-generated for the release body. This is a good foundation but adding a couple paragraphs to highlight the major features is a manual process. A bot can help to put some of this together but the process is generally best done by a human with intuition about what needs to be highlighted for users.

The steps for announcement are pretty straight-forward as follows:

- Generate the release notes
- Update the release markdown body, on Github, with the notes
- Announce the release, using the notes, via Discord
- Publish the discord announcement
- Make an X (twitter) post about the release

### Pre-Requisites for Announcing a Release

- Check that the tag is correct and pushed to GitHub
- Verify that the release has been created for the tag
- Look through the release changelog and make sure that it was generated correctly

### Generating Release Notes

Releases are published automatically via CI, but the release notes are created manually. Any additional release notes should be professional, comprehensive, and well-considered. Its best to have someone else review the release notes as these are critical public facing representations of our team.

To generate the release notes go through the PR's that were included in the release. This can be done alone or through discussion with the team, possibly in the [#lodestar-sync](https://discord.com/channels/593655374469660673/1343979094064234630) voice channel. When going through the list of PR's make some notes on a markdown document of which PR's have highlight worthy features. Generally there will be 2-5 things that are worth explicitly mentioning in the announcement. Once the list of notable features is compiled, go through the list and turn it into well written prose that really "sells" the release and explains why operators will want to upgrade.

### Release Notes Example

Hello Lodestar operators! We're excited to release v1.40.0 and **recommend** users upgrade for the latest features and best performance. This release brings significant memory and performance improvements, especially for PeerDAS supernodes.

Breaking change: Node.js v22 is no longer supported. If you are building from source, please ensure you are using Node.js v24 (the current LTS). Docker users are not affected.

Supernode stability and overall node health have been greatly improved. You will see drastic reduction in head selection time and much greater head accuracy through an improvement of block processing latency. The underlying changes will also improve sync latency to get your nodes up to head even faster than before.

We have added a couple of helpful api endpoints with this release. The first is targeted at operators running many validators and will allow api access to see which validator indices are connected to a node. This is also printed in the logs on an epoch basis to help infrastructure management teams with migrations and to avoid slashable incidents because of human or process reasons. We also added a nice to have feature, along with accompanying new flag --directPeers, to allow direct connection to specific peers as well as the ability to drop specific peers at runtime. You can also list the peerIds of all direct connections. You can also now query your peerDAS custody information for a running node.

For the full changelog, please see: https://github.com/ChainSafe/lodestar/releases/v1.40.0

### Publishing Release Notes

There are two major places that the release notes will get posted:

- The GitHub [release](https://github.com/ChainSafe/lodestar/releases)
- The [#lodestar-announcements](https://discord.com/channels/593655374469660673/741761870033191013) channel on our Discord [server](https://discord.gg/Hmpw3psQ3U)

You can see the [example](#release-notes-example) above posted [on Github here](https://github.com/ChainSafe/lodestar/releases/v1.40.0) and [on Discord here](https://discord.com/channels/593655374469660673/741761870033191013/1471208645609132287).

#### Updating the GitHub Release

To update the Github you simply go to the release page, click the pencil/edit icon and insert the release notes at the top of the markdown editor window. Click save and that's it. Easy peasy.

#### Announcing the Release on Discord

Just make an announcement in the #lodestar-announcements channel. Use the release notes as is but there are two small things to pay attention to.

One important thing to note is that for discord you should prepend the release notes with `@everyone` so that it is broadcast widely.

The other **_important step_** that you need to do is to **_publish_** the Discord announcement so that all other servers that follow our announcements get the notification to also publish the release to their followers. To do this click the megaphone/publish button on the post.

### Announcing the Release on X (twitter)

Everyone's favorite platform needs to hear about all the wonderful things that we built in our latest release. This is where the final step comes in. Log into twitter using the `lodestar_eth` account and make a tweet about the release and its virtues.

### Announcing the Release with a Blog Post

If appropriate, a blog post can be crafted with a more comprehensive narrative. The process for this is mostly ad-hoc and its up to you how you want the post to be worded with the caveat that it should be engaging and exciting for our users. Posting is something that the comms team at ChainSafe can help with. They have access to the blog infrastructure. We also have a Lodestar DevLog that is a good place to post information.
