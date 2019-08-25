# Introduction

> Thanks for your contribution to Lodestar. It's people like you that push the Ethereum ecosystem forward.

# Getting Started
- Run `lerna bootstrap` or `yarn install` to install dependencies

# Tests
- To run spec tests, you will need [git lfs](https://git-lfs.github.com/) installed, then execute `git submodule foreach git lfs pull` to download the spec tests submodule
  - NOTE: The spec tests submodule is HUGE, uses ~5GB
- Run `lerna run test:spec-min` for minimal spec tests
- Run `lerna run test:spec-main` for mainnet spec tests
- Run `lerna run test:unit` for unit tests
- Run `lerna run test:e2e` for end-to-end tests
- Run `lerna run test` to run all tests

# First-time Contributor?
Unsure where to begin contributing to Lodestar? Here are some ideas!

- See any typos? See any verbiage that should be changed or updated? Go for it! Github makes it easy to make contributions right from the browser.
- Look through our [outstanding unassigned issues](https://github.com/ChainSafe/lodestar/issues?q=is%3Aopen+is%3Aissue+no%3Aassignee).
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

- Functions and variables should be [`camelCase`](https://en.wikipedia.org/wiki/Camel_case), classes should be [`PascalCase`](http://wiki.c2.com/?PascalCase), constants should be `UPPERCASE_WITH_UNDERSCORES`.
- Use `"` instead of `'`
- All functions should have types declared for all parameters and return value
- All interfaces should be prefixed with a `I`
  - eg: `IMyInterface`
- You probably shouldn't be using Typescript's `any`
- PRs should only update a single package (in our monorepo) at a time
- Private class properties need not be prefixed with a `_`
  - eg: `private dirty;`, not `private _dirty;`
- Many module class constructors have the following signature: `(options, modules)`
  - eg: `public constructor(opts: IExampleOptions, {db, logger}: IExampleModules)`
- Make sure your code is properly linted
  - run `yarn lint` from the command line and use an IDE that will help
- Make sure that your code is properly type checked: 
  - run `yarn check-types` from the command line and use an IDE that will help
- Make sure that the tests are still passing: 
  - run `yarn test:unit` from the command line

# Community

Come chat with us on [discord](https://discord.gg/aMxzVcr)!
