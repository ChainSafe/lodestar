# Install from source

Make sure to have [Yarn installed](https://classic.yarnpkg.com/en/docs/install). It is also recommended to [install NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) and use v16 of [NodeJS](https://nodejs.org/en/).

<!-- prettier-ignore-start -->
!!! info
    NodeJS versions < 16.x are not supported by Lodestar. We currently recommend running NodeJS 16.x.
<!-- prettier-ignore-end -->

Clone the repo locally.

```bash
git clone https://github.com/chainsafe/lodestar.git
```

Install across all packages. Lodestar follows a [monorepo](https://github.com/lerna/lerna) structure, so all commands below must be run in the project root. Use the `--ignore-optional` flag to prevent downloading the Ethereum Consensus spec tests.

```bash
yarn install --ignore-optional
```

Build across all packages.

```bash
yarn run build
```

Or if you are using [Lerna](https://lerna.js.org/):

```bash
lerna bootstrap
```

Lodestar should now be ready for use.

```bash
./lodestar --help
```