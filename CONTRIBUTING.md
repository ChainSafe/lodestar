# Introduction

> Thanks for your contribution to Lodestar. It's people like you that push the Ethereum ecosystem forward.

# Prerequisites
- [Lerna](https://github.com/lerna/lerna)
- [Yarn](https://yarnpkg.com/)

# Getting Started
- Run `lerna bootstrap` or `yarn install` to install dependencies
- NOTE: By default the spec tests (5GB) will be installed with other dependencies. If you would like to avoid downloading the spec tests, instead run `yarn install --ignore-optional`.

# Tests
- Run `lerna run test:spec-min` for minimal spec tests
- Run `lerna run test:spec-main` for mainnet spec tests
- Run `lerna run test:unit` for unit tests
- Run `lerna run test:e2e` for end-to-end tests
- Run `lerna run test` to run all tests

# First-time Contributor?
Unsure where to begin contributing to Lodestar? Here are some ideas!

- See any typos? See any verbiage that should be changed or updated? Go for it! Github makes it easy to make contributions right from the browser.
- Look through our [outstanding unassigned issues](https://github.com/ChainSafe/lodestar/issues?q=is%3Aopen+is%3Aissue+no%3Aassignee). (hint: look for issues labeled "good first issue")
- Join our [discord chat](https://discord.gg/aMxzVcr)!

# Reporting a bug?
[Create a new issue!](https://github.com/ChainSafe/lodestar/issues/new/choose) Select the type of issue that best fits, and please fill out as much of the information as you can.

# Contribution process

1. Make sure you're familiar with our contribution guidelines (this document!)
2. Create your [own fork](https://github.com/ChainSafe/lodestar/fork) of this repo
3. Make your changes in your local fork
4. If you've made a code change, make sure to lint and test your changes (`yarn lint` and `yarn test:unit`)
5. Make a pull request! We review PRs on a regular basis.
6. You may be asked to sign a Contributor License Agreement (CLA). We make it relatively painless with CLA-bot.

# Lodestar Monorepo

We're currently experimenting with hosting the majority of lodestar packages and support packages in this repository as a [monorepo](https://en.wikipedia.org/wiki/Monorepo). We're using [Lerna](https://lerna.js.org/) to manage the packages.
See [packages/](https://github.com/ChainSafe/lodestar/tree/master/packages) for a list of packages hosted in this repo.

# Style Guide

- PRs should usually only update a single package (in our monorepo) at a time
- Many module class constructors have the following signature: `(options, dependencies)`
  - eg: `public constructor(opts: IExampleOptions, {db, logger}: IExampleModules)`
- Modules should be designed to "do one thing and do it well"
  - Consider the interface of a module -- events included, and make sure it is coherent
- Make sure your code is properly linted
  - use an IDE that will show linter errors/warnings
  - run `yarn lint` from the command line
  - common rules:
    - Functions and variables should be [`camelCase`](https://en.wikipedia.org/wiki/Camel_case), classes should be [`PascalCase`](http://wiki.c2.com/?PascalCase), constants should be `UPPERCASE_WITH_UNDERSCORES`.
    - Use `"` instead of `'`
    - All functions should have types declared for all parameters and return value
    - All interfaces should be prefixed with a `I`
      - eg: `IMyInterface`
    - You probably shouldn't be using Typescript's `any`
    - Private class properties should not be prefixed with a `_`
      - eg: `private dirty;`, not `private _dirty;`
- Make sure that your code is properly type checked: 
  - use an IDE that will show type errors
  - run `yarn check-types` from the command line
- Make sure that the tests are still passing: 
  - run `yarn test:unit` from the command line

# Community

Come chat with us on [discord](https://discord.gg/aMxzVcr)!
