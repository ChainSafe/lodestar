# Contribution Guidelines

Thanks for your interest in contributing to Lodestar. It's people like you that push the Ethereum ecosystem forward.

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS)
- :toolbox: [Yarn](https://yarnpkg.com/)

## Getting Started

- :gear: Run `yarn` to install dependencies.
- :gear: Run `yarn build` to build lib from source.
- :package: A `lodestar` binary will be bundled in `./packages/cli/bin`.
- :computer: Run `./lodestar --help` to get a list of available commands and arguments.

## Tests

To run tests:

- :test_tube: Run `yarn test:unit` for unit tests.
- :test_tube: Run `yarn test:e2e` for end-to-end tests.
- :test_tube: Run `yarn test:spec` for spec tests.
- :test_tube: Run `yarn test` to run all tests.
- :test_tube: Run `yarn check-types` to check TypeScript types.
- :test_tube: Run `yarn lint` to run the linter (ESLint).

Contributing to tests:

- Test must not depend on external live resources, such that running tests for a commit must be deterministic:
  - Do not pull data from external APIs like execution JSON RPC (instead run a local node).
  - Do not pull unpinned versions from DockerHub (use deterministic tag) or Github (checkout commit not branch).
  - Carefully design tests that depend on timing sensitive events like p2p network e2e tests. Consider that Github runners are significantly less powerful than your development environment.

### Debugging Spec Tests

- To fix errors always focus on passing all minimal tests first without running mainnet tests.
- Spec tests often compare full expected vs actual states in JSON format. To better understand the diff it's convenient to use mocha's option `--inline-diffs`.
- A single logical error can cause many spec tests to fail. To focus on a single test at a time you can use mocha's option `--bail` to stop at the first failed test
- To then run only that failed test you can run against a specific file as use mocha's option `--grep` to run only one case

```sh
LODESTAR_PRESET=minimal ../../node_modules/.bin/mocha --config .mocharc.spec.yml test/spec/phase0/sanity.test.ts --inline-diffs --bail --grep "attestation"
```

## Docker

The docker-compose file requires that a `.env` file be present in this directory. The `default.env` file provides a template and can be copied `.env`:

```sh
cp default.env .env
```

###### Beacon node only

```sh
docker-compose up -d
```

###### Beacon node and validator

First, you must have keystores and their secrets available locally at `./keystores` and your `password.txt` in `./secrets`

```sh
docker-compose -f docker-compose.yml -f docker-compose.validator.yml up -d
```

###### Dockerized metrics + local beacon node

Run a local beacon with `--metrics` enabled. Then start Prometheus + Grafana with all dashboards in `./dashboards` automatically loaded running:

```sh
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

If you are contributing from this repository prefix the branch name with your Github username (i.e. `myusername/short-description`)

**Pull Request Naming**

Pull request titles must be:

- Adhering to the [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary) spec
- Short and descriptive summary
- Written in imperative present tense
- Not end with a period

For example:

- feat: add lodestar prover for execution api
- fix: ignore known block in publish blinded block flow
- refactor(reqresp)!: support byte based handlers

**Pull Request Etiquette**

- Pull requests should remain as drafts when they are not ready for review by maintainers. Open pull requests signal to the maintainers that it's ready for review.
- If your pull request is no longer applicable or validated to fix an issue, close your pull request.
- If your pull request is fixable and needs additional changes or commits within a short period of time, switch your pull request into a draft until it's ready.
- Otherwise, close your pull request and [create a new issue instead.](https://github.com/ChainSafe/lodestar/issues/new/choose)

## Lodestar Monorepo

We're currently experimenting with hosting the majority of lodestar packages and support packages in this repository as a [monorepo](https://en.wikipedia.org/wiki/Monorepo). We're using [Lerna](https://lerna.js.org/) to manage the packages. See [packages/](https://github.com/ChainSafe/lodestar/tree/unstable/packages) for a list of packages hosted in this repository.

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
    - You shouldn't be using TypeScript type `any`
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
- Code white space can be helpful for reading complex code, please add some.
- For unit tests, we forbid import stubbing when other approaches are feasible.

## Tests style guide

Test must not depend on external live resources, such that running tests for a commit must be deterministic:

- Do not pull data from external APIs like execution JSON RPC (instead run a local node).
- Do not pull unpinned versions from dockerhub (use deterministic tag) or Github (checkout commit not branch).
- Carefully design tests that depend on timing sensitive events like p2p network e2e tests. Consider that Github runners are significantly less powerful than your development environment.

Add assertion messages where possible to ease fixing tests if they fail. If an assertion message is called from multiple times with the same stack trace, you **MUST** include an assertion message. For example, if an assertion is inside a for loop add some metadata to be able to locate the error source:

```ts
for (const blockResult of blocksResult) {
  expect(blockResult.status).equals("processed", `wrong block ${blockResult.id} result status`);
}
```

## Logging policy

### Logging Levels

Contributors must choose the log level carefully to ensure a consistent experience for every type of user:

- `error`: Critical issues that prevent the application from functioning correctly or cause significant disruption to users. Examples include failed network connections, crashes, or data corruption.
- `warn`: Situations that may lead to critical issues if not addressed but do not prevent the application from functioning. Examples include configuration issues, deprecated features, or temporary network disruptions.
- `info`: General sporadic informational about the node's state. Examples include initialization messages, infrequent periodic status updates, or high-level progress reports.
- `debug`: Detailed diagnostic information that can help developers or users troubleshoot specific issues. Examples include individual request logs for every REST API, networking interactions, or internal components status changes. Alias to `verbose`.

### Logging guidelines

- Avoid excessive logging. Log messages should be clear and concise, providing enough information to understand the context and severity of the issue.
- Do not log sensitive data, such as private keys, user credentials, or personal information.
- Do not log arbitrary data from the network as ASCII or UTF8 at levels higher or equal to `info`.
- Use clear and concise language. Prefer to log variables in JSON format `log.debug("Action", {slot})` instead of formatting the text yourself `log.debug('slot=${slot}')`.
- Include only relevant context in log messages, sufficient to debug the issue or action it refers to.

## Contributing to Grafana dashboards

To edit or extend an existing Grafana dashboard with minimal diff:

1. Grab the `.json` dashboard file from current unstable
2. Import the file to Grafana via the web UI at `/dashboard/import` without modifying the UID of the dashboard
3. Visually edit the dashboard
4. Once done make sure to leave the exact same visual aspect as before: same refresh interval, time range, etc.
5. Save the dashboard (CTRL+S)
6. Run download script, see [below](#using-download-script) on how to use it
7. Check git diff of updated dashboards, commit, push and open your PR

### Using Download Script

Create a file `.secrets.env` with envs

```sh
GRAFANA_API_KEY=$token
GRAFANA_URL=https://yourgrafanaapi.io
```

Run script to download dashboards to `./dashboards` folder

```sh
node scripts/download_dashboards.mjs
```

## Label Guide

Issues and pull requests are subject to the following labeling guidelines.

- PRs may have a status label to indicate deviation from the normal process such as `status-blocked` or `status-do-not-merge`
- Issues and PRs will be tagged with a `scope` and `prio` to indicate type and priority for triage.
- All other labels allow for further evaluation and organization.

Label descriptions can be found below.

###### `status.*` Issues and Pull Request Status

Status labels apply to issues and pull requests which deviate from normal processes.

###### `scope.*` Scope Indicator

Scope is comparable to Module labels but less strict with the definition of components. It applies to both, issues and pull requests.

###### `prio.*` Prioritization Indicator

A simple indicator of issue prioritization. It mainly applies to issues.

###### `spec.*` Ethereum Consensus Spec Version Target

Issues that target a specific version of the Ethereum consensus spec, shall be tagged accordingly.

## Community

Come chat with us on [Discord](https://discord.gg/aMxzVcr) and join our public weekly planning meetings!
