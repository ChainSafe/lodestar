# Connect to Altona testnet

Running a Lodestar node on the [Altona](https://github.com/goerli/altona) multi-client testnet only requires basic familiarity with the terminal.

Make sure lodestar is installed in your local environment. The following command should return a non error message. If it fails, go the [install guide](/install).

```
yarn run cli --help
```

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
yarn run cli beacon --testnet altona
```

Immediatelly you should see confirmation that the different modules have started

```bash
2020-06-21 17:34:24  [CHAIN]            info: Initializing beacon chain with state root 0x773c694b47504d789dc768d2356f691866b47833d0d85e02511d7cd339925b17 and genesis block root 0x19aa2deaa02cac9774eb8948a8ead1ebe851ba9590878a10cd5767092e16ba12
2020-06-21 17:34:25  [CHAIN]            info: Beacon chain initialized
2020-06-21 17:34:25  [NODE]             info: Starting eth2 beacon node - LODESTAR!
2020-06-21 17:34:25  [METRICS]          info: Starting metrics HTTP server on port 5000
2020-06-21 17:34:25  [DB]               info: Connected to LevelDB database at .altona/beacon/chain-db
2020-06-21 17:34:26  [CHAIN]            info: Chain started, waiting blocks and attestations
```

After finding some peers the chain should start processing blocks up to the current head

```
2020-06-21 17:35:31  [CHAIN]            info: Processed new chain head newChainHeadRoot=0x993d99d17c176263f246c96a232bd96d847543d7c90cc60ddc559edcab99b2e6, slot=111, epoch=3
2020-06-21 17:35:31  [CHAIN]            info: Processed new chain head newChainHeadRoot=0xcc1eb4c83cb0d9a9f7ed0045d2cd6257aadd226420baabd3d672be35605fe470, slot=112, epoch=3
2020-06-21 17:35:31  [CHAIN]            info: Processed new chain head newChainHeadRoot=0xb5c7b08a369c0943292a91e733f3feed184bc3c0b49d04878bc86e0705c15fe8, slot=113, epoch=3
```

<!-- prettier-ignore-start -->
!!! info
    If your node is stuck with `Current peerCount=0` review your network configuration to make sure your ports are open.
<!-- prettier-ignore-end -->

A young testnet (such as Altona) should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new) or reach out to us in [Discord](https://discord.gg/yjyvFRP). Just by reporting anomalities you are helping accelerate the progress of Eth2.0, thanks for contributing!

The `--testnet altona` flag automatically sets the following configuration options. You may overwrite them with flags if necessary:

- Use a genesis state file from `eth2-clients/eth2-testnets` since Eth1 genesis state processing is slow.
- Set `eth1.enabled` to false.
- Set the root directory to `.altona`.

## Run a validator

_TBD_

## Submit your deposit to Goerli

_TBD_
