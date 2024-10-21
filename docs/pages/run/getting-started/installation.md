# Install Options

## Binaries

Binaries can be downloaded from the Lodestar [release page](https://github.com/ChainSafe/lodestar/releases/latest) under the `Assets` section.

## Docker Installation

The [`chainsafe/lodestar`](https://hub.docker.com/r/chainsafe/lodestar) Docker Hub repository is maintained actively. It contains the `lodestar` CLI preinstalled.

:::info
The Docker Hub image tagged as `chainsafe/lodestar:next` is run on CI every commit on our `unstable` branch.
For `stable` releases, the image is tagged as `chainsafe/lodestar:latest`.
:::

Ensure you have Docker installed by issuing the command:

```bash
docker -v
```

It should return a non error message such as `Docker version xxxx, build xxxx`.

Pull, run the image and Lodestar should now be ready to use

```bash
docker pull chainsafe/lodestar
docker run chainsafe/lodestar --help
```

:::info
Docker is the recommended setup for Lodestar. Use our [Lodestar Quickstart scripts](https://github.com/ChainSafe/lodestar-quickstart) with Docker for detailed instructions.
:::

## Build from Source

### Prerequisites

Make sure to have [Yarn installed](https://classic.yarnpkg.com/en/docs/install). It is also recommended to [install NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) and use the LTS version (currently v22) of [NodeJS](https://nodejs.org/en/).

:::info
NodeJS versions older than the current LTS are not supported by Lodestar. We recommend running the latest Node LTS.
It is important to make sure the NodeJS version is not changed after reboot by setting a default `nvm alias default <version> && nvm use default`.
:::

:::note
Node Version Manager (NVM) will only install NodeJS for use with the active user. If you intend on setting up Lodestar to run under another user, we recommend using [NodeSource's source for NodeJS](https://github.com/nodesource/distributions/blob/master/README.md#installation-instructions) so you can install NodeJS globally.
:::

### Clone repository

Clone the repository locally and build from the stable release branch.

```bash
git clone -b stable https://github.com/chainsafe/lodestar.git
```

Switch to created directory.

```bash
cd lodestar
```

### Install packages

Install across all packages. Lodestar follows a [monorepo](https://github.com/lerna/lerna) structure, so all commands below must be run in the project root.

```bash
yarn install
```

### Build source code

Build across all packages.

```bash
yarn run build
```

### Lodestar CLI

Lodestar should now be ready for use.

```bash
./lodestar --help
```

See [Command Line Reference](./../beacon-management/beacon-cli.md) for further information.

### Known Issues

**ModuleNotFoundError: No module named 'distutils'**

If you stump upon this issue while running Yarn, it's because Python 3.12 had removed `distutils` package. That package is required for node build tool. You can install it with following command.

```bash
pip3 install setuptools --force-reinstall --user
```

## Install from NPM [not recommended]

:::danger
For mainnet (production) usage, we only recommend installing with Docker, using binaries or building from source due to [NPM supply chain attacks](https://hackaday.com/2021/10/22/supply-chain-attack-npm-library-used-by-facebook-and-others-was-compromised/). Until a [safer installation method has been found](https://github.com/ChainSafe/lodestar/issues/3596), do not use this install method except for experimental purposes only.
:::
