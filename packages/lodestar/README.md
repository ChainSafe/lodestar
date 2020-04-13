# Lodestar
[![](https://img.shields.io/travis/com/ChainSafe/lodestar/master.svg?label=master&logo=travis "Master Branch (Travis)")](https://travis-ci.com/ChainSafe/lodestar)
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
![ETH2.0_Spec_Version 0.10.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.10.1-2e86c1.svg)


## Prerequisites

* [Lerna](https://github.com/lerna/lerna)
* [Yarn](https://yarnpkg.com/)

## What you need
You will need to go over the [specification](https://github.com/ethereum/eth2.0-specs). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs). 

## Getting Started

To get an instance of Lodestar up & running, start a terminal from the root of the this repo:

1. Install dependencies accross all packages:
```
yarn install
```

2. Run the build script:
```
yarn run build
```


3. Lodestar should now be ready for use:
```
yarn run cli --help
```

Note:

Spec test cases are optional dependency which can be skipped by adding `--ignore-optional` when installing dependencies.
You can always download spec test cases by running `yarn install --force`.

### Development

#### Connect two beacon nodes

`cd packages/lodestar-cli`

Terminal 1:
`bin/lodestar dev -r -c 8` - It will run beacon node and 8 validators with all the default settings. State will be written to .tmp/state.ssz

Terminal 2:
`bin/lodestar dev --bootnodes "/ip4/127.0.0.1/tcp/30306" --multiaddrs "/ip4/127.0.0.1/tcp/30307" -v 0 -r` - Will connect to bootnode (node 1 default multiaddrs) and won't start validators.

<!---
### Starting private eth1 chain

`./bin/lodestar eth1:dev -m "vast thought differ pull jewel broom cook wrist tribe word before omit"`

This will start ganache server on `http://127.0.0.1:8545`. For more configuration check `./bin/lodestar eth1:dev --help`

### Starting lodestar beacon chain

`./bin/lodestar beacon --db test-db --eth1RpcUrl http://127.0.0.1:8545 --depositContract <depositContractAddress>`

You will see deposit contract address in console if you used `./bin/lodestar eth1:dev`.  

### Making validator deposit

`./bin/lodestar deposit -m "vast thought differ pull jewel broom cook wrist tribe word before omit" -n http://127.0.0.1:8545 -c <depositContractAddress>>`

This will trigger 10 deposits to deposit contract which will trigger beacon chain initialization. Make sure to use same mnemonic which you used to start eth1 network.  

**NOTE:** If you'd like to silence the client's logs, set the `LODESTAR_SILENCE` environment variable to `true`.
-->
