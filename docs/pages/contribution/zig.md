# Contribution Guidelines

Thanks for your interest in contributing to Lodestar. It's people like you that push the Ethereum ecosystem forward.

## Contribution Process

If you're reporting a bug or have a feature request,
create a new [issue](https://github.com/ChainSafe/lodestar/issues/new/choose).

> [!IMPORTANT]
> Please note that trivial, non-code contributions such as spelling, grammar, typos, corrections, comments and link fixes are not acceptable pull requests.
> Although we appreciate the effort to fix these valid concerns, it is not practical for us to run our CI systems to accommodate minor external contributions which generate minimal value for the purpose of contribution/airdrop farming.
> It would be appreciated for you to open up an issue instead for our team to aggregate these types of contributions into a batch commit.

If you wish to contribute code:

1. Make sure you're familiar with our contribution guidelines _(this document)_!
2. Before starting on any code, make sure to **leave a comment stating your intention**
   in the issue you are interested in or on our [Discord](https://discord.gg/aMxzVcr).
   We would prefer to have some form of human-to-human interaction before you
   contribute any code, especially since AI usage is commonplace today.
3. Create your [own fork](https://github.com/ChainSafe/lodestar/fork) and
   make the necessary changes. Test your changes locally first.
   See [Developer Usage](#developer-usage) below.
4. Make an open pull request when you're ready for it to be reviewed.
   See Pull request etiquette for more information.

### AI Assistance Notice

> [!IMPORTANT]
>
> The Lodestar team uses AI heavily in our work, but we have strict rules for AI contributions.
- **All AI usage in any form must be disclosed.** You must state
  the tool you used (e.g. Claude Code, Cursor, Amp) along with
  the extent that the work was AI-assisted.

- **PR descriptions, code changes, issues and discussions can use AI assistance
  but must have a full human-in-the-loop.** This means that any content
  generated with AI must have been reviewed _and edited_ by a human
  before submission. AI is very good at being overly verbose that
  distracts from the main point. Humans must do their research and
  trim this down. Our team appreciates and takes all contributions seriously,
  so AI output, if left unedited, is disrespectful of our time and effort.

- **The human-in-the-loop must fully understand all code.** If you
  can't explain what your changes do and how they interact with the
  greater system, do not contribute to this project.

- **Bad AI-generated PRs/issues will be de-prioritized or closed**.
  Bad contributions that are clearly AI (slop) will be de-prioritized
  or closed without warning.
  We love to help developers learn about Lodestar/Ethereum and grow.
  If you're interested in that then use AI responsibly.

Please remember that Lodestar is maintained by a small team of humans. Every
discussion, issue and pull request is read and reviewed by the team. It is
rude and disrespectful to attempt contributions with low-effort work,
since it puts the burden of validation on the maintainer.

## Developer Usage

We currently host all zig packages and napi bindings in [this repository](https://github.com/ChainSafe/lodestar)
as a [monorepo](https://en.wikipedia.org/wiki/Monorepo).
See [src/](https://github.com/ChainSafe/lodestar/tree/unstable/src) for a list of packages
and [packages/native/](https://github.com/ChainSafe/lodestar/tree/unstable/packages/native) for
a list of napi bindings hosted in this repository.

### Prerequisites

- [Zig](http://ziglang.org/) (0.16.0)
- [NodeJS](https://nodejs.org/) (LTS)
- [pnpm](https://pnpm.io/) (version pinned in the root package.json)

We follow a modified version of [TIGERSTYLE](../../../.gemini/styleguide.md) loosely.

Before opening a PR, please make sure all tests pass.

To do that, download the spec tests and era files used in testing:

```sh
# Download vectors pinned by build.zig.zon
zig build run:download_spec_tests

# Download era files
zig build run:download_era_files

# Generate test sources
zig build run:write_spec_tests
zig build run:write_ssz_generic_spec_tests
zig build run:write_ssz_static_spec_tests
zig build run:write_bls_spec_tests
```

### Test layout

Tests live beside the code they cover, and a module holds at most one `test` block. A single
inline test works as a usage example. As soon as there is a second, the tests are a suite and move
into a sibling `<module>_test.zig`, wired back from the module itself:

```zig
// src/clock/slot_math.zig

// ... implementation ...

test {
    _ = @import("slot_math_test.zig");
}
```

```zig
// src/clock/slot_math_test.zig
const std = @import("std");
const slot_math = @import("slot_math.zig");
const slotAtMs = slot_math.slotAtMs;

test "slotAtMs returns genesis slot at genesis" {
    // ...
}
```

A few things to keep in mind:

- Name the test file after its module in snake_case. `Node.zig` pairs with `node_test.zig`.
- Put the `test { _ = @import(...); }` block in the module under test rather than in the package
  `root.zig`, so moving or deleting a module carries its tests along with it.
- Do not mark a declaration `pub` just so a test can reach it from the sibling file. Tests that
  deliberately exercise private internals belong inline; `src/cpu_count.zig` and
  `src/state_transition/load_state.zig` are examples.

If you created new unit tests, you can run them individually.
For example, if you made a new unit test in the `ssz` package:

```sh
zig build test:ssz -Dtest:ssz.filters="my full test name"
```

If you made changes that affect spec relevant behavior, run:

```sh
zig build test:spec_tests -Dpreset={mainnet,minimal}
```

And run all other tests:

```sh
zig build test
```

And format all files:

```sh
zig fmt .
```

`tidy` is a custom linter for repo-wide rules that a formatter cannot express, currently covering
test layout and test discovery. CI runs it, and so should you:

```sh
zig build test:tidy
```

It takes its file list from `git ls-files`, so run it after `git add` when you add new files.

If you made a change to the bindings, make sure the bindings tests pass:

```sh
pnpm --filter @lodestar/native install

# Build bindings
zig build build-lib:bindings --prefix packages/native/zig-out

# Build for a specific preset through package scripts
pnpm --filter @lodestar/native prepare-mainnet
pnpm --filter @lodestar/native prepare-minimal
pnpm --filter @lodestar/native prepare-gnosis

# Run binding tests
pnpm --filter @lodestar/native test

# Run Biome
pnpm --filter @lodestar/native lint
pnpm --filter @lodestar/native exec biome check --write .
```

## GitHub Style Guide

**Branch Naming**

If you are contributing from this repository prefix the branch name with your GitHub username (i.e. `myusername/short-description`).

**Pull Request Naming**

Pull request titles must be:

- Adhering to the [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary) spec
- Short and descriptive summary
- Written in imperative present tense
- Not end with a period

For example:

- refactor(bindings): use owned typed arrays for BLS outputs
- chore: remove merge transition code

**Pull Request Etiquette**

- Pull requests should remain as drafts when they are not ready for review by maintainers.
  Open pull requests signal to the maintainers that it's ready for review.
- If your pull request is no longer applicable or validated to fix an issue, close your pull request.
- If your pull request is fixable and needs additional changes or commits within a short period of time, switch your pull request into a draft until it's ready.
- Otherwise, close your pull request and [create a new issue instead.](https://github.com/ChainSafe/lodestar/issues/new/choose)

## Managing and Opening Feature/Large PRs

To maintain code quality, improve collaboration, and ensure clarity in large or complex changes, we follow these guidelines when opening pull requests (PRs). Depending on the nature of the change, PRs fall into three categories:

### 1. Single, Complete PR

If the PR contains a self-contained and complete feature or bug fix that does not require major refactoring or cross-team discussions, then:

- Fill in the PR template. Motivation is never empty: state the problem at whatever length it
  needs, quote the error or log, and link the issue or discussion. Description is one sentence
  saying what the PR does, with further detail appropriate to the change.
- Keep simple changes brief. Use bullets, tables, or short subsections when they clarify
  before/after behavior, tradeoffs, or validation. Include the context needed to review the change
  in the PR description, and link CI instead of repeating routine output.
- If the PR modifies critical code paths, add references to relevant issues, benchmarks, or related discussions.
- Ensure the PR adheres to our standard PR etiquette and commit message guidelines.

### 2. PR with Major Refactoring

If the PR involves significant code refactoring, structural changes, or fundamental modifications where team input is needed:

- Create a GitHub issue or Discord Thread before writing code.
- Outline the problem, your proposed approach, and any alternative solutions.
- Request feedback and build consensus with the team.
- Summarize the outcome and link the issue in the PR description once consensus is reached.
- If changes affect multiple packages or require coordination with ongoing development,
  summarize any key decisions from the issue in the PR description.

### 3. Large Feature or Multi-PR Implementation

If the PR introduces large-scale changes, affecting multiple areas of the codebase or requiring step-by-step integration:

- Document the feature first before opening any PR.
- Open a GitHub Discussion with a detailed technical proposal explaining the feature. This should include details like:
  - Big picture explanation of how and why the feature will help or will change the codebase
  - Rough outline of the code that will be implemented
  - If a functional implementation is used, a brief description of what each function will do,
    possibly with a basic function signature if it is clear what will be needed
  - Broad overview of how data will flow and integrate with the surrounding sub-systems
  - Rough discussion of potential performance (CPU and memory) implications
- Share the document with the team and gather feedback before implementation.
- Create a feature branch to showcase the entire implementation. The idea will be to get this branch deployed on a feature group to test.
  Throughout the process, metrics will be analyzed to ensure there are no regressions.
- First merge any refactor work necessary to get `main` prepared for the feature.
- Create a second empty feature branch from `main` after the refactor work is merged.
- Break down the implementation into smaller, manageable PRs that merge into the empty feature branch.
- Each PR should focus on a specific part of the feature.
  This middle part of the review is focused on API, implementation overview and other high-level pieces but will be relatively limited as the API discussion,
  analysis of the feature branch and full review on merge to `main` are the important steps.
- Link the design document in each PR description so reviewers can always refer to the full scope.
- Merge the smaller PRs into the feature branch until the complete feature is ready for a final merge into the `main` branch.
  This is the "formal review process" where several team members will likely get involved.
  Up to this point it's mostly peer review. The merge to `main` is where details like naming, function signature,
  type definitions, etc will be scrutinized. This is also where metrics from the initial implementation branch
  will get a detailed, final analysis.
