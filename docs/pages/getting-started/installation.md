# Installation

## Docker Installation

The [`chainsafe/lodestar`](https://hub.docker.com/r/chainsafe/lodestar) Docker Hub repository is maintained actively. It contains the `lodestar` CLI preinstalled.

<!-- prettier-ignore-start -->
!!! info
    The Docker Hub image tagged as `chainsafe/lodestar:next` is run on CI every commit on our `unstable` branch.
    For `stable` releases, the image is tagged as `chainsafe/lodestar:latest`.
<!-- prettier-ignore-end -->

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

<!-- prettier-ignore-start -->
!!! info
    Docker is the recommended setup for Lodestar. Use our [Lodestar Quickstart scripts](https://github.com/ChainSafe/lodestar-quickstart) with Docker for detailed instructions.
<!-- prettier-ignore-end -->

## Build from Source

### Prerequisites

Make sure to have [Yarn installed](https://classic.yarnpkg.com/en/docs/install). It is also recommended to [install NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) and use the LTS version (currently v20) of [NodeJS](https://nodejs.org/en/).

<!-- prettier-ignore-start -->
!!! info
    NodeJS versions older than the current LTS are not supported by Lodestar. We recommend running the latest Node LTS.
    It is important to make sure the NodeJS version is not changed after reboot by setting a default `nvm alias default <version> && nvm use default`.

!!! note
    Node Version Manager (NVM) will only install NodeJS for use with the active user. If you intend on setting up Lodestar to run under another user, we recommend using [NodeSource's source for NodeJS](https://github.com/nodesource/distributions/blob/master/README.md#installation-instructions) so you can install NodeJS globally.
<!-- prettier-ignore-end -->

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

See [Command Line Reference](./../reference/cli.md) for further information.
