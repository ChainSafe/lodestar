# Installation

Lodestar runs on Linux, MacOS and Windows.

[TOC]

## Install and build from source

```bash
git clone https://github.com/chainsafe/lodestar.git
```

Install across all packages

```bash
yarn install
```

Build across all packages

```bash
yarn run build
```

Lodestar should now be ready for use:

```bash
yarn run cli --help
```

## Install from NPM

Install globally

```
npm install -g @chainsafe/lodestar-cli
```

```
yarn global add @chainsafe/lodestar-cli
```

Lodestar should now be ready to use:

```
lodestar --help
```

## Install with docker

The [`chainsafe/lodestar`](https://hub.docker.com/r/chainsafe/lodestar) Docker Hub repository is mantained actively. It contains all lodestar components, accessible via the `lodestar`.

<!-- prettier-ignore-start -->
!!! info
    The Docker Hub image in run on CI every nightly release on `master`
<!-- prettier-ignore-end -->

Ensure you have Docker installed by issuing the command. It should return a non error message such as `Docker version xxxx, build xxxx`.

```bash
docker -v
```

Pull, run the image and Lodestar should now be ready to use

```bash
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
