# Install from source

## Prerequisites

Make sure to have [Yarn installed](https://classic.yarnpkg.com/en/docs/install). It is also recommended to [install NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) and use the LTS version (currently v18) of [NodeJS](https://nodejs.org/en/).

<!-- prettier-ignore-start -->
!!! info
    NodeJS versions older than the current LTS are not supported by Lodestar. We recommend running the latest Node LTS.

!!! note
    Node Version Manager (NVM) will only install NodeJS for use with the active user. If you intend on setting up Lodestar to run under another user, we recommend using [Nodesource's source for NodeJS](https://github.com/nodesource/distributions/blob/master/README.md#installation-instructions) so you can install NodeJS globally.
<!-- prettier-ignore-end -->

## Clone repository

Clone the repo locally.

```bash
git clone https://github.com/chainsafe/lodestar.git
```

Switch to created directory.

```bash
cd lodestar
```

<!-- prettier-ignore-start -->
!!! warning
    `git clone` will check out the default `unstable` branch. If you are running Lodestar in production, we recommend to either use the `stable` branch
    by running `git switch stable` or to use a specific version by running `git checkout <version>`, e.g. `git checkout v1.3.0`.
<!-- prettier-ignore-end -->

## Install packages

Install across all packages. Lodestar follows a [monorepo](https://github.com/lerna/lerna) structure, so all commands below must be run in the project root. Use the `--ignore-optional` flag to prevent downloading the Ethereum Consensus spec tests.

```bash
yarn install --ignore-optional
```

## Build source code

Build across all packages.

```bash
yarn run build
```

Or if you are using [Lerna](https://lerna.js.org/):

```bash
lerna bootstrap
```

## Lodestar CLI

Lodestar should now be ready for use.

```bash
./lodestar --help
```

See [Command Line Reference](./../reference/cli.md) for further information.
