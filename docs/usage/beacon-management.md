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

When starting up a Lodestar beacon node in any configuration, ensure you add the `--jwt-secret $JWT_SECRET_PATH` flag to point to the saved secret key file.

### Ensure JWT is configured with your execution node

**For Go Ethereum:**
Use the `--authrpc.jwtsecret /data/jwtsecret` flag to configure the secret. Use their documentation [here](https://geth.ethereum.org/docs/interface/merge).

**For Nethermind:**
Use the `--JsonRpc.JwtSecretFile /data/jwtsecret` flag to configure the secret. Use their documentation [here](https://docs.nethermind.io/nethermind/first-steps-with-nethermind/running-nethermind-post-merge#jwtsecretfile).

**For Besu:**
Use the `--engine-jwt-secret=<FILE>` flag to configure the secret. Use their documentation [here](https://besu.hyperledger.org/en/stable/Reference/CLI/CLI-Syntax/#engine-jwt-secret).

**For Erigon:**
Use the `--authrpc.jwtsecret` flag to configure the secret. Use their documentation [here](https://github.com/ledgerwatch/erigon#authentication-api).

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
./lodestar beacon --network $NETWORK_NAME --jwt-secret $JWT_SECRET_PATH
```

This will assume an execution-layer client is available at the default
location of `https://localhost:8545`.

In case execution-layer clients are available at different locations, use `--execution.urls` to specify these locations in the command:

```bash
./lodestar beacon --network $NETWORK_NAME --jwt-secret $JWT_SECRET_PATH --execution.urls $EL_URL1 $EL_URL2
```

Immediately you should see confirmation that the node has started

```bash
Nov-29 15:59:48.479[]                 info: Lodestar network=sepolia, version=v1.2.1/q9f/docs/14898d5, commit=14898d5beea341bc7d450dd494dcb9efbb9556fa
Nov-29 15:59:48.518[]                 info: Connected to LevelDB database path=/home/user/.local/share/lodestar/sepolia/chain-db
Nov-29 15:59:49.347[network]          info: PeerId 16Uiu2HAm9kKss7LSRU5Z6xYz7Rr5JzWVz8njqx7Ezyj4SSDcpT2Q, Multiaddrs /ip4/127.0.0.1/tcp/9000/p2p/16Uiu2HAm9kKss7LSRU5Z6xYz7Rr5JzWVz8njqx7Ezyj4SSDcpT2Q,/ip4/192.168.1.26/tcp/9000/p2p/16Uiu2HAm9kKss7LSRU5Z6xYz7Rr5JzWVz8njqx7Ezyj4SSDcpT2Q
Nov-29 15:59:49.457[rest]             info: Started REST API server address=http://127.0.0.1:9596
Nov-29 15:59:49.458[]                 warn: Low peer count peers=0
Nov-29 15:59:49.459[]                 info: Searching peers - peers: 0 - slot: 1164899 (skipped 1164899) - head: 0 0xfb9b…de43 - finalized: 0x0000…0000:0
Nov-29 15:59:54.001[]                 info: Searching peers - peers: 0 - slot: 1164899 (skipped 1164899) - head: 0 0xfb9b…de43 - finalized: 0x0000…0000:0
Nov-29 16:00:06.003[]                 info: Searching peers - peers: 0 - slot: 1164900 (skipped 1164900) - head: 0 0xfb9b…de43 - finalized: 0x0000…0000:0
Nov-29 16:00:18.003[]                 info: Searching peers - peers: 0 - slot: 1164901 (skipped 1164901) - head: 0 0xfb9b…de43 - finalized: 0x0000…0000:0
Nov-29 16:00:30.002[]                 info: Syncing - 1.4 days left - 9.47 slots/s - slot: 1164902 (skipped 1164423) - head: 479 0x72b4…df6b - finalized: 0xfc3e…bbb0:13 - peers: 3
Nov-29 16:00:42.001[]                 info: Syncing - 13 hours left - 25.3 slots/s - slot: 1164903 (skipped 1163304) - head: 1599 0x5692…f542 - finalized: 0xc72e…122e:48 - peers: 3
Nov-29 16:00:54.001[]                 info: Syncing - 8.3 hours left - 38.7 slots/s - slot: 1164904 (skipped 1162153) - head: 2751 0xaac6…3aa6 - finalized: 0xbfeb…a990:83 - peers: 3
```

<!-- prettier-ignore-start -->
!!! info
    If your node is stuck with `Searching for peers` review your network configuration to make sure your ports are open.
<!-- prettier-ignore-end -->

By default, Lodestar stores all configuration and chain data at the path `$XDG_DATA_HOME/lodestar/$NETWORK_NAME`.

A young testnet should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new) or reach out to us in [Discord](https://discord.gg/yjyvFRP). Just by reporting anomalies you are helping accelerate the progress of Ethereum Consensus, thanks for contributing!

<!-- prettier-ignore-start -->
!!! warning
    It is dangerous to expose your Beacon APIs publicly as there is no default authentication mechanism provided. Ensure your beacon node host is not exposing ports 8545 or 9596 outside of your internal network.
<!-- prettier-ignore-end -->

### Checkpoint Sync

If you are starting your node from a blank db/genesis (or from last saved state in db) in a network which is now far ahead, your node is susceptible to "long range attacks" via something called weak subjectivity.
[Read Vitalik's illuminating post on the same](https://blog.ethereum.org/2014/11/25/proof-stake-learned-love-weak-subjectivity/).

If you have a synced beacon node available (e.g., your friend's node or an infrastructure provider) and a trusted checkpoint you can rely on, you can start off your beacon node in under a minute! And at the same time kicking the "long range attack" in its butt!

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
