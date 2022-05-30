# Contribution Guidlines

Thanks for your contribution to Lodestar. It's people like you that push the Ethereum ecosystem forward.

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS/Gallium)
- :toolbox: [Yarn](https://yarnpkg.com/)/[Lerna](https://lerna.js.org/)

## Getting Started

- :gear: Run `lerna bootstrap` or `yarn install` to install dependencies.
- :gear: Run `yarn build` to build lib from source.
- :package: A `lodestar` binary will be bundled in `./packages/cli/bin`.
- :computer: Run `./lodestar --help` to get a list of available commands and argurments.

## Tests

- :test_tube: Run `lerna run test:spec-min` for minimal spec tests.
- :test_tube: Run `lerna run test:spec-main` for mainnet spec tests.
- :test_tube: Run `lerna run test:unit` for unit tests.
- :test_tube: Run `lerna run test:e2e` for end-to-end tests.
- :test_tube: Run `lerna run test` to run all tests.

### Debugging spec tests

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

First, you must have keystores and their secrets available locally at `./keystores` and `./secrets`

```
docker-compose -f docker-compose.yml -f docker-compose.validator.yml up -d
```

###### Dockerized metrics + local beacon node:

```
docker-compose -f docker/docker-compose.local.yml up -d
```

## First-time Contributor?

Unsure where to begin contributing to Lodestar? Here are some ideas!

- :pencil2: See any typos? See any verbiage that should be changed or updated? Go for it! Github makes it easy to make contributions right from the browser.
- :mag_right: Look through our [outstanding unassigned issues](https://github.com/ChainSafe/lodestar/issues?q=is%3Aopen+is%3Aissue+no%3Aassignee). (Hint: look for issues labeled `meta0-goodfirstissue` or `meta1-helpwanted`!)
- :speech_balloon: Join our [Discord chat](https://discord.gg/aMxzVcr)!
  [![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)

## Reporting a bug?

- :spiral_notepad: [Create a new issue!](https://github.com/ChainSafe/lodestar/issues/new/choose) Select the type of issue that best fits, and please fill out as much of the information as you can.

## Contribution process

1. Make sure you're familiar with our contribution guidelines _(this document)_!
2. Create your [own fork](https://github.com/ChainSafe/lodestar/fork) of this repository.
3. Make your changes in your local fork.
4. If you've made a code change, make sure to lint and test your changes (`yarn lint` and `yarn test:unit`).
5. Make a pull request! We review PRs on a regular basis.
6. You may be asked to sign a Contributor License Agreement (CLA). We make it relatively painless with CLA-bot.

## Github style guide

**Branch naming**

If you are contributing from this repo prefix the branch name with your Github username (i.e. `myusername/short-description`)

**Pull request naming**

Pull request titles must be:

- Short and descriptive summary
- Should be capitalized and written in imperative present tense
- Not end with period

For example:

> Add Edit on Github button to all the pages

## Lodestar Monorepo

We're currently experimenting with hosting the majority of lodestar packages and support packages in this repository as a [monorepo](https://en.wikipedia.org/wiki/Monorepo). We're using [Lerna](https://lerna.js.org/) to manage the packages. See [packages/](https://github.com/ChainSafe/lodestar/tree/unstable/packages) for a list of packages hosted in this repo.

## Style Guide

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
    - All interfaces should be prefixed with a `I`
      - e.g.: `IMyInterface`
    - You shouldn't be using TypeScript's `any`
    - Private class properties should not be prefixed with a `_`
      - e.g.: `private dirty;`, not `private _dirty;`
- Make sure that your code is properly type checked:
  - use an IDE that will show type errors
  - run `yarn check-types` from the command line
- Make sure that the tests are still passing:
  - run `yarn test:unit` from the command line

## Contributing to Grafana dashboards

To edit or extend an existing Grafana dashboard with minimal diff:

1. Grab the .json dashboard file from current unstable
2. Import file to Grafana via the web UI at `/dashboard/import`. Give it some temporal name relevant to your work (i.e. the branch name)
3. Do edits on the Dashboard
4. Once done make sure to leave the exact same visual aspect as before: same refresh interval, collapsed rows, etc.
5. Click the "share dashboard" icon next to the title at the top left corner. Go to the "Export" tab, set "Export for sharing externally" to true and click "Save to file"
6. Paste the contents of the downloaded file in the Github repo, commit and open your PR

## Label Guide

Issues and pull-requests are subject to the following labeling guidelines.

- Each PR **must have** a `status.*` label indicating the status.
- Each Issue or PR **must have** a `mod.*` or `scope.*` label indicating which parts of the code are relevant.
- All other labels allow for further evaluation, e.g., priority, amount of work required, etc.

Label descriptions can be found below.

###### `status.*` Pull Request Status

Status labels only apply to pull requests.

- `status0-blocked`: This is blocked by another issue that requires resolving first.
- `status1-donotmerge`: Merging this issue will break the build. Do not merge!
- `status2-onice`: This work is on ice as per the reasons described by the author.
- `status3-needsreview`: This pull-request needs a review.
- `status4-needschanges`: This pull-request has issues that needs to be addressed first.
- `status5-mergeready`: This pull-request has been reviewed well and can be merged.
- `status6-bulldozer`: Pull request is reviewed and can be merged (used by the bulldozer bot).
- `status7-opendiscussion`: This work is still being discussed.
- `status9-workinprogress`: This work is still in progress and not ready for review.

###### `mod.*` Relevant Modules and Components

The Module labels should be applied to all issues and pull requests if possible.

- `mod1-beaconchain`: The @chainsafe/lodestar beacon-chain module.
- `mod2-validator`: The @chainsafe/lodestar-validator module.
- `mod3-lightclient`: The @chainsafe/lodestar-light-client module.
- `mod4-api`: The @chainsafe/lodestar-api module.
- `mod5-cli`: The @chainsafe/lodestar-cli module.
- `mod6-statetransition`: The @chainsafe/lodestar-beacon-state-transition module.
- `mod7-types`: The @chainsafe/lodestar-types module.
- `mod8-params`: The @chainsafe/lodestar-params module.
- `mod9-utils`: The @chainsafe/lodestar-utils module.
- `moda-config`: The @chainsafe/lodestar-config module.
- `modb-database`: The @chainsafe/lodestar-db module.
- `modc-forkchoice`: The @chainsafe/lodestar-fork-choice module.
- `modd-spectests`: The @chainsafe/lodestar-spec-test-\* modules.

###### `scope.*` Scope Indicator

Scope is comparable to Module labels but less strict with the definition of components. It applies to both, issues and pull requests.

- `scope1-audits`: Resolves issue identified in the first audit.
- `scope2-memory`: Issues to reduce and improve memory usage.
- `scope3-performance`: Performance issue and ideas to improve performance.
- `scope4-benchmarks`: All issues with regards to benchmarking.
- `scope5-networking`: All issues related to networking, gossip, and libp2p.
- `scope6-metrics`: All issues with regards to the exposed metrics.
- `scope7-ssz`: All issues related to SSZ serialization and deserialization.
- `scope8-bls`: All issues related to BLS and cryptography used.
- `scope9-testnetdebugging`: Issues uncovered through running a node on a public testnet.
- `scopea-eth1`: All issues related to the Eth1 provider.
- `scopeb-ci`: All issues related to the Continuous Integration and Github Workflows.
- `scopec-documentation`: All issues related to the Lodestar documentation.

###### `prio.*` Prioritization Indicator

A simple indicator of issue prioritization. It mainly applies to issues.

- `prio0-critical`: Drop everything to resolve this immediately.
- `prio2-high`: Resolve issues as soon as possible.
- `prio5-medium`: Resolve this some time soon (tm).
- `prio7-low`: This is nice to have.
- `prio9-none`: We might get back to this one day (maybe).

###### `q.*` Effort Quantization

Effort estimations can help planning to tackle issues that are particulary easy or difficult with regard of work force required. It mainly applies to issues (before work is started).

- `q0-trivial`: Can be fixed by anyone with access to a computer.
- `q2-easy`: Can be fixed by copy and pasting from StackOverflow.
- `q3-medium`: A fair chunk of work, not necessarily very hard but not trivial either
- `q5-substantial`: Can be fixed by a developer with decent experience.
- `q7-involved`: Can be fixed by a team of developers and probably takes some time.
- `q9-epic`: Can only be fixed by John Skeet. ;)

###### `spec.*` Ethereum Consensus Spec Version Target

Issues that target a specific version of the Ethereum consensus spec, shall be tagged accordingly.

- `spec0-phase0`: Issues targeting the initial Ethereum consensus spec version.
- `spec1-altair`: Issues targeting the Altair Ethereum consensus spec version.
- `spec3-bellatrix`: Issues targeting the Bellatrix Ethereum consensus spec version.
- `spec5-phase1`: Issues targeting the Phase1 Ethereum consensus spec version.
- `spec7-phase2`: Issues targeting the Phase2 Ethereum consensus spec version.

###### `meta.*` Meta Labels to organize Miscelaneous Issues

- `meta0-goodfirstissue`: Good first issues for newcomers and first-time contributors.
- `meta1-helpwanted`: The author indicates that additional help is wanted.
- `meta2-breakingchange`: Introduces breaking changes to DB, Validator, Beacon Node, or CLI interfaces. Handle with care!
- `meta4-cosmetic`: The changes introduces are barely touching any code.
- `meta5-technicaldebt`: Issues introducing or resolving technical debts.
- `meta6-discussion`: Indicates a topic that requires input from various developers.
- `meta7-botstale`: Label for stale issues (applied by the stale bot).
- `meta8-excludefromchangelog`: This work is not relevant for the changelog (used by Github actions). Use sparingly!
- `meta9-dependencies`: Pull requests that update a dependency (used by Dependabot).

## Community

Come chat with us on [Discord](https://discord.gg/aMxzVcr) and join our public weekly planning meetings!
