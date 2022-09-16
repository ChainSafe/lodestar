# Beacon management

The following instructions are required to setup and run a Lodestar beacon node.

[TOC]

## Connect to mainnet or a public testnet

Running a Lodestar node on mainnet or a testnet only requires basic familiarity with the terminal.

Make sure Lodestar is installed in your local environment, following the chosen install method. The following command should return a non error message.

```bash
./lodestar --help
```

For a complete list of beacon node CLI commands and options, see the [Command Line Reference](../../reference/cli/)

To select a known testnet or mainnet, use the `--network` flag. `mainnet` is selected by default, and a list of available networks is listed with the `--help` flag. Setting the `--network` flag will conveniently configure the beacon node or validator client for the selected network. For power users, any configuration option should be able to be overridden.

## Configure the Lodestar JWT authentication token

Post-Merge Ethereum will require [secure authentication with the Engine API](https://github.com/ethereum/execution-apis/blob/main/src/engine/authentication.md) connection on your chosen Execution node.

<!-- prettier-ignore-start -->
!!! info
    Post-Merge Ethereum **requires** a secure, authenticated connection to the Execution client on port 8551. We recommend setting this up now to ensure a proper configuration before the Merge.
<!-- prettier-ignore-end -->

### Generate a secret key

You must generate a secret 32-byte (64 characters) hexadecimal string that will be used to authenticate with an execution node. You can use the following command in most terminals to generate a random secret: `openssl rand -hex 32`. Or you can use an [online generator](https://codebeautify.org/generate-random-hexadecimal-numbers). Save this secret key into a text file and note where you store this file.

### Configure Lodestar to locate the JWT secret

When starting up a Lodestar beacon node in any configuration, ensure you add the `--jwt-secret /path/to/file` flag to point to the saved secret key file.

### Ensure JWT is configured with your execution node

**For Go Ethereum:**
Use the `--authrpc.jwtsecret /data/jwtsecret` flag to configure the secret. Use their documentation [here](https://geth.ethereum.org/docs/interface/merge).

**For Nethermind:**
Use the `--JsonRpc.JwtSecretFile /data/jwtsecret` flag to configure the secret. Use their documentation [here](https://docs.nethermind.io/nethermind/first-steps-with-nethermind/running-nethermind-post-merge#jwtsecretfile).

**For Besu:**
Use the `--engine-jwt-secret=<FILE>` flag to configure the secret. Use their documentation [here](https://besu.hyperledger.org/en/stable/Reference/CLI/CLI-Syntax/#engine-jwt-secret).

**For Erigon:**
Use the `--authrpc.jwtsecret` flag to configure the secret. Use their documentation [here](https://github.com/ledgerwatch/erigon#authentication-api).

## Initialize a beacon node (optional)

If you would like to initialize your beacon node with the basic files required to run on a testnet or mainnet before actually running the node (Especially useful for configuring a new testnet), you can run the following command:

```bash
./lodestar init --network $NETWORK_NAME
```

By default, Lodestar stores all configuration and chain data at the path `$XDG_DATA_HOME/lodestar/$NETWORK_NAME`.

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
./lodestar beacon --network $NETWORK_NAME
```

This will assume an eth1 client is available at the default location of `localhost:8545`.

In case eth1 clients are available at different locations, use `--eth1.providerUrls` to specify these locations in the command:

```bash
./lodestar beacon --network $NETWORK_NAME --eth1.providerUrls eth1.url1 eth1.url2
```

It is also possible to start a Lodestar beacon that does not follow the eth1 chain. For this, use the `eth1` option in the command:

```bash
./lodestar beacon --eth1 false --network $NETWORK_NAME
```

Immediately you should see confirmation that the node has started

```bash
Jul-09 17:32:34.895 []                 info: Lodestar version=0.26.0 master 8058d367, network=prater
Jul-09 17:32:34.920 [DB]               info: Connected to LevelDB database name=/home/user/.local/share/lodestar/prater/chain-db
Jul-09 17:32:46.419 []                 info: Initializing beacon state slot=0, epoch=0, stateRoot=0x895390e92edc03df7096e9f51e51896e8dbe6e7e838180dadbfd869fdd77a659
Jul-09 17:33:13.502 [NETWORK]          info: PeerId 16Uiu2HAmHXf37Pa4whSF1rdwWbkqDuiwd3U7wqTgadQVza48MTn4, Multiaddrs /ip4/127.0.0.1/tcp/9000
Jul-09 17:33:13.503 []                 warn: Low peer count peers=0
Jul-09 17:33:13.504 []                 info: Searching for peers - peers: 0 - finalized: 0 0x0000…0000 - head: 0 0x8c0e…ee87 - clockSlot: 780166
Jul-09 17:33:18.001 []                 info: Searching for peers - peers: 0 - finalized: 0 0x0000…0000 - head: 0 0x8c0e…ee87 - clockSlot: 780166
Jul-09 17:33:30.000 []                 info: Searching for peers - peers: 0 - finalized: 0 0x0000…0000 - head: 0 0x8c0e…ee87 - clockSlot: 780167
Jul-09 17:33:42.002 []                 info: Searching for peers - peers: 0 - finalized: 0 0x0000…0000 - head: 0 0x8c0e…ee87 - clockSlot: 780168
Jul-09 17:33:54.000 []                 info: Searching for peers - peers: 0 - finalized: 0 0x0000…0000 - head: 0 0x8c0e…ee87 - clockSlot: 780169
Jul-09 17:34:06.000 []                 info: Searching for peers - peers: 0 - finalized: 0 0x0000…0000 - head: 0 0x8c0e…ee87 - clockSlot: 780170
Jul-09 17:34:18.386 []                 info: Syncing - 30 days left - 0.297 slots/s - finalized: 0 0x0000…0000 - head: 30 0x0bcf…0506 - clockSlot: 780171 - peers: 1
Jul-09 17:34:30.448 []                 info: Syncing - 8.1 days left - 1.12 slots/s - finalized: 2 0x8e30…3ce0 - head: 128 0xd4f1…d32b - clockSlot: 780172 - peers: 1
Jul-09 17:34:42.205 []                 info: Syncing - 4.2 days left - 2.15 slots/s - finalized: 5 0x2811…5120 - head: 255 0x6c99…033b - clockSlot: 780173 - peers: 1
Jul-09 17:34:54.278 []                 info: Syncing - 3 days left - 3.00 slots/s - finalized: 8 0x65e2…52a9 - head: 351 0x0f5a…1cd3 - clockSlot: 780174 - peers: 1
```

<!-- prettier-ignore-start -->
!!! info
    If your node is stuck with `Searching for peers` review your network configuration to make sure your ports are open.
<!-- prettier-ignore-end -->

A young testnet should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new) or reach out to us in [Discord](https://discord.gg/yjyvFRP). Just by reporting anomalies you are helping accelerate the progress of Ethereum Consensus, thanks for contributing!

<!-- prettier-ignore-start -->
!!! warning
    It is dangerous to expose your Beacon APIs publicly as there is no default authentication mechanism provided. Ensure your beacon node host is not exposing ports 8545 or 9596 outside of your internal network. 
<!-- prettier-ignore-end -->

### Checkpoint Sync

If you are starting your node from a blank db/genesis (or from last saved state in db) in a network which is now far ahead, your node is susceptible to "long range attacks" via something called weak subjectivity.
[Read Vitalik's illuminating post on the same](https://blog.ethereum.org/2014/11/25/proof-stake-learned-love-weak-subjectivity/).

If you have a synced beacon node available (e.g. your friend's node or an infrastructure provider) and a trusted checkpoint you can rely on, you can start off your beacon node in under a minute! And at the same time kicking the "long range attack" in its butt!

Just supply these **extra args** to your beacon node command:

```bash
--checkpointSyncUrl <synced node url> [--wssCheckpoint <trusted checkpoint in root:epoch format>]
```

In case you really trust `checkpointSyncUrl` then you may skip providing `wssCheckpoint`, which will then result into your beacon node syncing and starting off the recently finalized state from the trusted url.

<!-- prettier-ignore-start -->
!!! warning
    Please use this option very carefully (and at your own risk), a malicious server URL can put you on the wrong chain with a danger of you losing your funds by social engineering. 
If possible, validate your `wssCheckpoint` from multiple places (e.g. different client distributions) or from other trusted sources. This will highly reduce the risk of starting off on a malicious chain.
<!-- prettier-ignore-end -->
