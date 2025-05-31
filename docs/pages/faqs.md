# Frequently Asked Questions

This section of the documentation will cover common questions and common encounters by users and developers.

## Developer Tooling

### Python Distutils

:::note "MacOS: ModuleNotFoundError: No module named 'distutils'"
When using the `yarn` command, some MacOS users may experience this error if they are running Python 3.12+. The `distutils` module has been removed from the standard Python library via PEP 632 which deprecates and eliminates `distutils` in favor of other tools like `setuptools`.

For MacOS, there is no direct equivalent package to Linux's `python3-distutils`. Therefore, the solution is to install the `python-setuptools` package via Homebrew: `brew install python-setuptools`

:::

### Yarn Package Manager

:::note "Package manager issues"

Lodestar relies on [Corepack](https://nodejs.org/api/corepack.html) and associated `packageManager` value to manage its package manager version.

Make sure `corepack` is correctly enabled if you encounter some package manager related issues:

```bash
corepack enable
```

:::

## Troubleshooting Lodestar

### Running a beacon node

:::note "Heap memory limit"
Lodestar beacon node requires at least 8GB of heap space. While the `lodestar` script and the official docker image correctly sets the appropriate value, it might be necessary to manually set it for some specific scenario.

The simplest way to achieve this is via the `NODE_OPTIONS` environment variable or by passing [`--max-old-space-size`](https://nodejs.org/api/cli.html#--max-old-space-sizesize-in-megabytes) directly to the node binary

```bash
NODE_OPTIONS: --max-old-space-size=8192
```

:::

### Using Kubernetes

:::note "Unknown arguments error"
Lodestar reads all environment variables prefixed with `LODESTAR` and will try to parse
them similar to command line arguments, meaning any unknown argument will cause an error.

```txt
✖ Unknown arguments: servicePort, servicePortEthConsensusP2p,
port9000Tcp, port9000TcpPort, port9000TcpProto, port9000TcpAddr, serviceHost
```

The extra arguments are present because Kubernetes automatically
[adds environment variables](https://kubernetes.io/docs/concepts/services-networking/service/#environment-variables)
to the Pod based on the name (`metadata.name`) defined in the associated `Service`.
To resolve the issue, this name has to be changed to something that does not start with `lodestar`.

Reference Issue: [#6045](https://github.com/ChainSafe/lodestar/issues/6045)
:::
