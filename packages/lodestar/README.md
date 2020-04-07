# Lodestar
[![](https://img.shields.io/travis/com/ChainSafe/lodestar/master.svg?label=master&logo=travis "Master Branch (Travis)")](https://travis-ci.com/ChainSafe/lodestar)
[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
![ETH2.0_Spec_Version 0.10.1](https://img.shields.io/badge/ETH2.0_Spec_Version-0.10.1-2e86c1.svg)

Typescript imlementation of the Eth2.0 beacon chain

## What you need
You will need to go over the [specification](https://github.com/ethereum/lodestar-specs). You will also need to have a [basic understanding of sharding](https://github.com/ethereum/wiki/wiki/Sharding-FAQs). Note that that the specification is an ongoing document and will get outdated. The reference implementation by the Ethereum development team is written in Python and can be found [here](https://github.com/ethereum/beacon_chain).

## Run dev

`../lodestar-cli/bin/lodestar dev`

#### Generating flame graphs from spec tests
Example of cpu-profile generation of blocksanity tests in current directory

`GEN_PROFILE_DIR=$PWD mocha -r ./.babel-register 'test/spec/sanity/blocks/blocksanity_s_mainnet.test.ts'`

To view results:
```bash
npm i -g 0x
0x --visualize-cpu-profile ./0\ -\ blocksanity-1561705313935.cpuprofile
```
Open resulting html file in favorite browser.

## Usage
1. If you haven't `yarn install`
2. `lerna run build`
3. `packages/lodestar-cli/bin/lodestar --help`

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