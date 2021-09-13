# Contribution Guidlines

Thanks for your contribution to Lodestar. It's people like you that push the Ethereum ecosystem forward.

## Prerequisites

- :gear: [NodeJS](https://nodejs.org/) (LTS/Fermium)
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
- :mag_right: Look through our [outstanding unassigned issues](https://github.com/ChainSafe/lodestar/issues?q=is%3Aopen+is%3Aissue+no%3Aassignee). _(Hint: look for issues labeled "good first issue"!)_
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

## Lodestar Monorepo

We're currently experimenting with hosting the majority of lodestar packages and support packages in this repository as a [monorepo](https://en.wikipedia.org/wiki/Monorepo). We're using [Lerna](https://lerna.js.org/) to manage the packages. See [packages/](https://github.com/ChainSafe/lodestar/tree/master/packages) for a list of packages hosted in this repo.

## Style Guide

- Pull requests should usually only update a single package (in our monorepo) at a time
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

## Community

Come chat with us on [Discord](https://discord.gg/aMxzVcr)!
