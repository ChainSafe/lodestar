# Command Line Interface for Lodestar
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
![ETH2.0_Spec_Version 0.11.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.11.1-2e86c1.svg)


This helps start Beacon Node, Validator ... in other packages.

### Lodecli

We have an experimental new CLI called `lodecli` which currently provides a subset of the `lodestar` CLI functionality.

`./bin/lodecli beacon init` - this will write a configuration and network identity to disk, by default `./.lodecli`
`./bin/lodecli beacon run` - this will run a beacon node using a configuration from disk, by default `./.lodecli`
