# Contribution Guidelines

Thanks for your interest in contributing to Lodestar. It's people like you that push the Ethereum ecosystem forward.

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS)
- :toolbox: [Yarn](https://yarnpkg.com/)/[Lerna](https://lerna.js.org/)

## Getting Started

- :gear: Run `yarn` to install dependencies.
- :gear: Run `yarn build` to build lib from source.
- :package: A `lodestar` binary will be bundled in `./packages/cli/bin`.
- :computer: Run `./lodestar --help` to get a list of available commands and arguments.

## Tests

- :test_tube: Run `lerna run test:unit` for unit tests.
- :test_tube: Run `lerna run test:e2e` for end-to-end tests.
- :test_tube: Run `lerna run test:spec` for spec tests.
- :test_tube: Run `lerna run test` to run all tests.
- :test_tube: Run `yarn check-types` to check TypeScript types.
- :test_tube: Run `yarn lint` to run the linter (ESLint).

### Debugging Spec Tests

- To fix errors always focus on passing all minimal tests first without running mainnet tests.
- Spec tests often compare full expected vs actual states in JSON format. To better understand the diff it's convenient to use mocha's option `--inline-diffs`.
- A single logical error can cause many spec tests to fail. To focus on a single test at a time you can use mocha's option `--bail` to stop at the first failed test
- To then run only that failed test you can run against a specific file as use mocha's option `--grep` to run only one case

```
LODESTAR_PRESET=minimal ../../node_modules/.bin/mocha --config .mocharc.spec.yml test/spec/phase0/sanity.test.ts --inline-diffs --bail --grep "attestation"
```

## Docker

The docker-compose file requires that a `.env` file be present in this directory. The `default.env` file provides a template and can be copied `.env`:

```
cp default.env .env
```

###### Beacon node only:

```
docker-compose up -d
```

###### Beacon node and validator:

First, you must have keystores and their secrets available locally at `./keystores` and your password.txt in `./secrets`

```
docker-compose -f docker-compose.yml -f docker-compose.validator.yml up -d
```

###### Dockerized metrics + local beacon node:

Run a local beacon with `--metrics` enabled. Then start Prometheus + Grafana with all dashboards in `./dashboards` automatically loaded running:

```
./docker/docker-compose.local_dev.sh
```

## First Time Contributor?

Unsure where to begin contributing to Lodestar? Here are some ideas!

- :pencil2: See any typos? See any verbiage that should be changed or updated? Go for it! Github makes it easy to make contributions right from the browser.
- :mag_right: Look through our [outstanding unassigned issues](https://github.com/ChainSafe/lodestar/issues?q=is%3Aopen+is%3Aissue+no%3Aassignee). (Hint: look for issues labeled `meta-good-first-issue` or `meta-help-wanted`!)
- :speech_balloon: Join our [Discord chat](https://discord.gg/aMxzVcr)!
  [![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)

## Reporting A Bug?

- :spiral_notepad: [Create a new issue!](https://github.com/ChainSafe/lodestar/issues/new/choose) Select the type of issue that best fits, and please fill out as much of the information as you can.

## Contribution Process

1. Make sure you're familiar with our contribution guidelines _(this document)_!
2. Create your [own fork](https://github.com/ChainSafe/lodestar/fork) of this repository.
3. Make your changes in your local fork.
4. If you've made a code change, make sure to lint and test your changes (`yarn lint` and `yarn test:unit`).
5. Make an open pull request when you're ready for it to be reviewed. We review PRs on a regular basis. See Pull request etiquette for more information.
6. You may be asked to sign a Contributor License Agreement (CLA). We make it relatively painless with CLA-bot.

## Github Style Guide

**Branch Naming**

If you are contributing from this repo prefix the branch name with your Github username (i.e. `myusername/short-description`)

**Pull Request Naming**

Pull request titles must be:

- Short and descriptive summary
- Should be capitalized and written in imperative present tense
- Not end with a period

For example:

> Add Edit on Github button to all the pages

**Pull Request Etiquette**

- Pull requests should remain as drafts when they are not ready for review by maintainers. Open pull requests signal to the maintainers that it's ready for review.
- If your pull request is no longer applicable or validated to fix an issue, close your pull request.
- If your pull request is fixable and needs additional changes or commits within a short period of time, switch your pull request into a draft until it's ready.
- Otherwise, close your pull request and [create a new issue instead.](https://github.com/ChainSafe/lodestar/issues/new/choose)

## Lodestar Monorepo

We're currently experimenting with hosting the majority of lodestar packages and support packages in this repository as a [monorepo](https://en.wikipedia.org/wiki/Monorepo). We're using [Lerna](https://lerna.js.org/) to manage the packages. See [packages/](https://github.com/ChainSafe/lodestar/tree/unstable/packages) for a list of packages hosted in this repo.

## Style Guide

- Lodestar has migrated to using ES modules.
- Many module class constructors have the following signature: `(options, dependencies)`
  - e.g.: `public constructor(opts: IExampleOptions, {db, logger}: IExampleModules)`
- Modules should be designed to _"do one thing and do it well!"_
  - Consider the interface of a module -- events included, and make sure it is coherent
- Make sure your code is properly linted
  - use an IDE that will show linter errors/warnings
  - run `yarn lint` from the command line
  - common rules:
    - Functions and variables should be [`camelCase`](https://en.wikipedia.org/wiki/Camel_case), classes should be [`PascalCase`](http://wiki.c2.com/?PascalCase), constants should be `UPPERCASE_WITH_UNDERSCORES`.
    - Use `"` instead of `'`
    - All functions should have types declared for all parameters and return value
    - You shouldn't be using TypeScript's `any`
    - Private class properties should not be prefixed with a `_`
      - e.g.: `private dirty;`, not `private _dirty;`
- Make sure that your code is properly type checked:
  - use an IDE that will show type errors
  - run `yarn check-types` from the command line
- Make sure that the tests are still passing:
  - run `yarn test:unit` from the command line
- Commenting: If your code does something that is not obvious or deviates from standards, leave a comment for other developers to explain your logic and reasoning.
  - Use `//` commenting format unless it's a comment you want people to see in their IDE.
  - Use `/** **/` commenting format for documenting a function/variable.
- Code whitespace can be helpful for reading complex code, please add some.
- For unit tests, we forbid import stubbing when other approaches are feasible.
- Logging framework: When determining which log level to use for providing information to users, consider the level of importance and whether the alert is actionable (Warning, Error, Fatal).
  - Trace: Describes events showing step by step execution which can be ignored during standard operation.
  - Debug: Useful information for debugging purposes.
  - Info: Purely informative logs which can be ignored during normal operation.
  - Warning: Unexpected behaviour, but the application continues to function and key operations are unaffected.
  - Error: One or more main functionalities are not working, preventing some functions from working properly.
  - Fatal: One or more main functionalities are not working and preventing the application from fulfilling its duties.

## Contributing to Grafana dashboards

To edit or extend an existing Grafana dashboard with minimal diff:

1. Grab the .json dashboard file from current unstable
2. Import file to Grafana via the web UI at `/dashboard/import`. Give it some temporal name relevant to your work (i.e. the branch name)
3. Do edits on the Dashboard
4. Once done make sure to leave the exact same visual aspect as before: same refresh interval, collapsed rows, etc.
5. Click the "share dashboard" icon next to the title at the top left corner. Go to the "Export" tab, set "Export for sharing externally" to true and click "Save to file"
6. Paste the contents of the downloaded file in the Github repo, commit and open your PR

## Label Guide

Issues and pull requests are subject to the following labeling guidelines.

- PRs may have a status label to indicate deviation from the normal process such as `status-blocked` or `status-do-not-merge`
- Issues and PRs will be tagged with a `scope` and `prio` to indicate type and priority for triaging.
- All other labels allow for further evaluation and organization.

Label descriptions can be found below.

###### `status.*` Issues and Pull Request Status

Status labels apply to issues and pull requests which deviate from normal processes.

- `status-blocked`: This is blocked by another issue that requires resolving first.
- `status-do-not-merge`: Merging this issue will break the build. Do not merge!

###### `scope.*` Scope Indicator

Scope is comparable to Module labels but less strict with the definition of components. It applies to both, issues and pull requests.

- `scope-cpu-performance`: Performance issue and ideas to improve performance.
- `scope-documentation`: All issues related to the Lodestar documentation.
- `scope-interop`: Issues that fix interop issues between Lodestar and CL, EL or tooling.
- `scope-light-clients`: All issues regarding light client development.
- `scope-logging`: Issue about logs: hygiene, format issues, improvements.
- `scope-memory`: Issues to reduce and improve memory usage.
- `scope-metrics`: All issues with regards to the exposed metrics.
- `scope-networking`: All issues related to networking, gossip, and libp2p.
- `scope-profitability`: Issues to directly improve validator performance and its profitability.
- `scope-security`: Issues that fix security issues: DOS, key leak, CVEs.
- `scope-testing`: Issues for adding test coverage, fixing existing tests or testing strategies
- `scope-testnet-debugging`: Issues uncovered through running a node on a public testnet.
- `scope-ux`: Issues for CLI UX or general consumer UX.

###### `prio.*` Prioritization Indicator

A simple indicator of issue prioritization. It mainly applies to issues.

- `prio0-critical`: Drop everything to resolve this immediately.
- `prio1-high`: Resolve issues as soon as possible.
- `prio2-medium`: Resolve this some time soon (tm).
- `prio3-low`: This is nice to have.

###### `spec.*` Ethereum Consensus Spec Version Target

Issues that target a specific version of the Ethereum consensus spec, shall be tagged accordingly.

- `spec-phase0`: Issues targeting the initial Ethereum consensus spec version.
- `spec-altair`: Issues targeting the Altair Ethereum consensus spec version.
- `spec-bellatrix`: Issues targeting the Bellatrix Ethereum consensus spec version.

###### `meta.*` Meta Labels to organize Miscellaneous Issues

- `meta-breaking-change`: Introduces breaking changes to DB, Validator, Beacon Node, or CLI interfaces. Handle with care!
- `meta-dependencies`: Pull requests that update a dependency.
- `meta-discussion`: Indicates a topic that requires input from various developers.
- `meta-good-first-issue`: Good first issues for newcomers and first-time contributors.
- `meta-help-wanted`: The author indicates that additional help is wanted.
- `meta-pm`: Issues relating to Project Management tasks.
- `meta-stale`: Label for stale issues applied by the stale bot.
- `meta-technicaldebt`: Issues introducing or resolving technical debts.

## Community

Come chat with us on [Discord](https://discord.gg/aMxzVcr) and join our public weekly planning meetings!
