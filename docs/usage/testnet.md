# Connect to Mainnet or a Public Testnet

Running a Lodestar node on a multi-client testnet or mainnet only requires basic familiarity with the terminal.

Make sure lodestar is installed in your local environment. The following command should return a non error message. If it fails, go the [install guide](../../installation/).

```bash
./lodestar --help
```

For a complete list of beacon node CLI commands and options, see the [Command Line Reference](../../reference/cli/)

For a list of available testnets to use for the `--network` flag (as shown anywhere below where `--network $NETWORK_NAME` is shown), look for the `testnet` option as listed with the `--help` flag above. You should see something like this:

> --network Use a network configuration [string][choices: "pyrmont", "mainnet"]

In this case, the two networks that are available are the pyrmont multiclient testnet, and the eth2 mainnet.

<!-- prettier-ignore-start -->
!!! info
Only use `mainnet` if you wish to interact with data on the live eth2 beacon chain.
<!-- prettier-ignore-end -->

## Initialize a beacon node (optional)

If you would like to initialize your beacon node with the basic files required to run on a testnet or mainnet before actually running the node (e.g. perhaps you want a basic configuration setup that you would like to then configure yourself), you can run the following command:

```bash
./lodestar beacon --network $NETWORK_NAME
```

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
./lodestar beacon --network $NETWORK_NAME
```

<!-- prettier-ignore-start -->
!!! info
    Until genesis for the given network, the node will stay idle waiting for all genesis conditions to pass.  In the case of mainnet, this condition should not happen since genesis has already begun since Dec 1, 2020.
<!-- prettier-ignore-end -->

Immediately you should see confirmation that the different modules have started

```bash
2020-12-15 15:45:21 [DB]               info: Connected to LevelDB database name=/home/yourNameHere/.local/share/lodestar/pyrmont/chain-db
2020-12-15 15:45:25 []                 info: Initializing beacon state from db slot=0, epoch=0, stateRoot=0x2bb257ca66d05a047a65fe43a5f457b674de445d917cca029efb09b3ba4758c4
2020-12-15 15:45:25 [DB]               info: Connected to LevelDB database name=/home/yourNameHere/.local/share/lodestar/pyrmont/chain-db
2020-12-15 15:45:29 [API]              warn: Server listening at http://127.0.0.1:9596
2020-12-15 15:45:29 [API]              info: Started rest api server address=http://127.0.0.1:9596
2020-12-15 15:45:29 [METRICS]          info: Starting metrics HTTP server port=8008
2020-12-15 15:45:30 [NETWORK]          info: PeerId 16Uiu2HAmTfyqcJ8Ym8oUXGtsSLoDZUeScGASkPBmSskUVrGWGWPW, Multiaddrs /ip4/127.0.0.1/tcp/9000,/ip4/192.168.1.70/tcp/9000,/ip4/172.18.0.1/tcp/9000
2020-12-15 15:45:30 [SYNC]             info: Waiting for peers...
2020-12-15 15:45:30 [SYNC]             warn: Current peerCount=0, required = 3
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

A young testnet (i.e. one whose genesis time was relatively recently) should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new) or reach out to us in [Discord](https://discord.gg/yjyvFRP). Just by reporting anomalities you are helping accelerate the progress of Eth2.0, thanks for contributing!

The `--network $NETWORK_NAME` flag automatically sets the following configuration options. You may overwrite them with flags if necessary:

- Use a genesis state file from [eth2-clients/eth2-testnets](https://github.com/eth2-clients/eth2-testnets/) since Eth1 genesis state processing is slow.
- Set `eth1.enabled` to false.
- Set the root directory to `.$NETWORK_NAME`.

## Run a validator

To start a Lodestar validator run the command:

```bash
./lodestar validator --network $NETWORK_NAME
```

You should see confirmation that modules have started.

```bash
2020-08-07 14:14:24  []                 info: Decrypted 2 validator keystores
2020-08-07 14:14:24  [VALIDATOR 0X8BAC4815] info: Setting up validator client...
2020-08-07 14:14:24  [VALIDATOR 0X8BAC4815] info: Setting up RPC connection...
2020-08-07 14:14:24  []                 info: Checking genesis time and beacon node connection
2020-08-07 14:14:24  [VALIDATOR 0X8E44237B] info: Setting up validator client...
2020-08-07 14:14:24  [VALIDATOR 0X8E44237B] info: Setting up RPC connection...
```
