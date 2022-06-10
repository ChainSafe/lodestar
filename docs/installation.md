# Installation

Lodestar runs on Linux, MacOS and Windows.

[TOC]

## Install from source

Make sure to have [Yarn installed](https://classic.yarnpkg.com/en/docs/install). It is also recommended to [install NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) and use the latest LTS version of [NodeJS](https://nodejs.org/en/).

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

Build across all packages

```bash
yarn run build
```

Or if you are using [Lerna](https://lerna.js.org/):

```bash
lerna bootstrap
```

Lodestar should now be ready for use:

```bash
./lodestar --help
```

## Install from NPM [not recommended]

<!-- prettier-ignore-start -->
!!! danger
    For mainnet (production) usage, we only recommend installing with docker due to NPM supply chain attacks, [example here](https://hackaday.com/2021/10/22/supply-chain-attack-npm-library-used-by-facebook-and-others-was-compromised/). [Until a safer installation method has been found](https://github.com/ChainSafe/lodestar/issues/3596), do not use this install method except for experimental purposes.
<!-- prettier-ignore-end -->

## Install with docker

The [`chainsafe/lodestar`](https://hub.docker.com/r/chainsafe/lodestar) Docker Hub repository is mantained actively. It contains the `lodestar` CLI preinstalled.

<!-- prettier-ignore-start -->
!!! info
    The Docker Hub image is run on CI every dev release on `unstable`
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

## Specifications

Hardware specifications minimum / recommended, to run the Lodestar client.

|           | Minimum                          | Recommended                       |
| --------- | -------------------------------- | --------------------------------- |
| Processor | Intel Core i5–760 or AMD FX-8100 | Intel Core i7–4770 or AMD FX-8310 |
| Memory    | 4GB RAM                          | 8GB RAM                           |
| Storage   | 20GB available space SSD         | 100GB available space SSD         |
| Internet  | Broadband connection             | Broadband connection              |
