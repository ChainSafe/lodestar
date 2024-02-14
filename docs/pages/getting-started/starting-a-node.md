# Beacon management

The following instructions are required to setup and run a Lodestar beacon node.

[TOC]

## Connect to mainnet or a public testnet

Running a Lodestar node on mainnet or a testnet only requires basic familiarity with the terminal.

Make sure Lodestar is installed in your local environment, following the chosen install method. The following command should return a non error message.

```bash
./lodestar --help
```

For a complete list of beacon node CLI commands and options, see the [`beacon` CLI Command](../beacon-management/beacon-cli.md) section.

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

When starting up a Lodestar beacon node in any configuration, ensure you add the `--jwtSecret $JWT_SECRET_PATH` flag to point to the saved secret key file.

### Ensure JWT is configured with your execution node

**For Go Ethereum:**
Use the `--authrpc.jwtsecret /data/jwtsecret` flag to configure the secret. Use their documentation [here](https://geth.ethereum.org/docs/interface/merge).

**For Nethermind:**
Use the `--JsonRpc.JwtSecretFile /data/jwtsecret` flag to configure the secret. Use their documentation [here](https://docs.nethermind.io/nethermind/first-steps-with-nethermind/running-nethermind-post-merge#jwtsecretfile).

**For Besu:**
Use the `--engine-jwt-secret=<FILE>` flag to configure the secret. Use their documentation [here](https://besu.hyperledger.org/en/stable/Reference/CLI/CLI-Syntax/#engine-jwt-secret).

**For Erigon:**
Use the `--authrpc.jwtsecret` flag to configure the secret. Use their documentation [here](https://github.com/ledgerwatch/erigon?tab=readme-ov-file#beacon-chain-consensus-layer).

## Run a beacon node

To start a Lodestar beacon run the command:

```bash
./lodestar beacon --network $NETWORK_NAME --jwtSecret $JWT_SECRET_PATH
```

This will assume an execution-layer client is available at the default
location of `https://localhost:8545`.

In case execution-layer clients are available at different locations, use `--execution.urls` to specify these locations in the command:

```bash
./lodestar beacon --network $NETWORK_NAME --jwtSecret $JWT_SECRET_PATH --execution.urls $EL_URL1 $EL_URL2
```

Immediately you should see confirmation that the node has started

```txt
pr-20 15:12:45.274[]                 info: Lodestar network=mainnet, version=v1.7.2, commit=
Apr-20 15:12:45.327[]                 info: Connected to LevelDB database path=/data/mt1/chain-db
Apr-20 15:12:57.747[]                 info: Initializing beacon from a valid db state slot=6264480, epoch=195765, stateRoot=0x8133cd4d0be59c3e94405f902fe0ad68ffaa5013b525dddb6285b91ad79716f6, isWithinWeakSubjectivityPeriod=true
Apr-20 15:13:18.077[network]          info: PeerId 16Uiu2HAmDsGet67va6VCnaW2Tu1Ae2yujiDMnmURMMWNvssER7ZQ, Multiaddrs /ip4/127.0.0.1/tcp/9000/p2p/16Uiu2HAmDsGet67va6VCnaW2Tu1Ae2yujiDMnmURMMWNvssER7ZQ,/ip4/10.244.0.199/tcp/9000/p2p/16Uiu2HAmDsGet67va6VCnaW2Tu1Ae2yujiDMnmURMMWNvssER7ZQ
Apr-20 15:13:18.270[rest]             info: Started REST API server address=http://127.0.0.1:9596
Apr-20 15:13:18.271[]                 warn: Low peer count peers=0
Apr-20 15:13:18.280[]                 info: Searching peers - peers: 0 - slot: 6264964 - head: (slot - 484) 0x7ee6…2a15 - exec-block: syncing(17088043 0x9442…) - finalized: 0xe359…4d7e:195763
Apr-20 15:13:23.009[chain]            info: Validated transition configuration with execution client terminalTotalDifficulty=0xc70d808a128d7380000, terminalBlockHash=0x0000000000000000000000000000000000000000000000000000000000000000, terminalBlockNumber=0x0
Apr-20 15:13:29.287[]                 info: Syncing - ? left - 0.00 slots/s - slot: 6264965 - head: (slot - 485) 0x7ee6…2a15 - exec-block: syncing(17088043 0x9442…) - finalized: 0xe359…4d7e:195763 - peers: 1
Apr-20 15:14:41.003[]                 info: Syncing - 22 seconds left - 4.92 slots/s - slot: 6264971 - head: (slot - 108) 0xd15f…b605 - exec-block: valid(17088414 0x3dba…) - finalized: 0x70fd…5157:195775 - peers: 4
Apr-20 15:14:53.001[]                 info: Syncing - 9 seconds left - 5.00 slots/s - slot: 6264972 - head: (slot - 45) 0x44e4…20a4 - exec-block: valid(17088475 0xca61…) - finalized: 0x9cbd…ba83:195776 - peers: 8
Apr-20 15:15:01.443[network]          info: Subscribed gossip core topics
Apr-20 15:15:01.446[sync]             info: Subscribed gossip core topics
Apr-20 15:15:05.000[]                 info: Synced - slot: 6264973 - head: 0x90ea…c655 - exec-block: valid(17088521 0xca9b…) - finalized: 0x6981…682f:195778 - peers: 6
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

If you are starting your node from a blank db, like starting from genesis, or from the last saved state in db and the network is now far ahead, your node will be susceptible to "long range attacks." Ethereum's solution to this is via something called weak subjectivity. [Read Vitalik's illuminating post explaining weak subjectivity.](https://blog.ethereum.org/2014/11/25/proof-stake-learned-love-weak-subjectivity/).

If you have a synced beacon node available (e.g., your friend's node or an infrastructure provider) and a trusted checkpoint you can rely on, you can start off your beacon node in under a minute! And at the same time kicking the "long range attack" in its butt!

Just supply these **extra arguments** to your beacon node command:

```bash
--checkpointSyncUrl <synced node url> [--wssCheckpoint <trusted checkpoint in root:epoch format>]
```

In case you really trust `checkpointSyncUrl` then you may skip providing `wssCheckpoint`, which will then result into your beacon node syncing and starting off the recently finalized state from the trusted URL.

<!-- prettier-ignore-start -->
!!! warning
    Please use this option very carefully (and at your own risk), a malicious server URL can put you on the wrong chain with a danger of you losing your funds by social engineering.
If possible, validate your `wssCheckpoint` from multiple places (e.g. different client distributions) or from other trusted sources. This will highly reduce the risk of starting off on a malicious chain.
<!-- prettier-ignore-end -->

**Taking too long to sync?**

After your node has been offline for a while, it might be the case that it takes a long time to sync even though a `checkpointSyncUrl` is specified.
This is due to the fact that the last db state is still within the weak subjectivity period (~15 days on mainnet) which causes the node
to sync from the db state instead of the checkpoint state.

It is possible to force syncing from checkpoint state by supplying the `--forceCheckpointSync` flag. This option is only recommended if it is absolutely
necessary for the node to be synced right away to fulfill its duties as there is an inherent risk each time the state is obtained from an external source.

### Guide to the sync logs

Lodestar beacon sync log aims to provide information of utmost importance about your node and yet be succinct at the same time. You may see the sync logs in the following format:

`[Sync status] - [ Slot info ] - [Head info] - [Exec block info] - [Finalized info] - [Peers info]`

See the following example of different kinds of sync log:

```txt
Apr-20 15:24:08.034[]                 info: Searching peers - peers: 0 - slot: 6265018 - head: 6264018 0xed93…7b0a - exec-block: syncing(17088476 0x9649…) - finalized: 0xbf30…7e7c:195777
Apr-20 15:24:17.000[]                 info: Searching peers - peers: 0 - slot: 6265019 - head: 6264018 0xed93…7b0a - exec-block: syncing(17088476 0x9649…) - finalized: 0xbf30…7e7c:195777
```

```txt
Apr-20 15:13:41.298[]                 info: Syncing - 2.5 minutes left - 2.78 slots/s - slot: 6264966 - head: 6262966 0x5cec…f5b8 - exec-block: valid(17088105 0x6f74…) - finalized: 0x5cc0…3874:195764 - peers: 1
Apr-20 15:13:41.298[]                 info: Syncing - 2 minutes left - 2.78 slots/s - slot: 6264967 - head: 6263965 0x5cec…f5b8 - exec-block: valid(17088105 0x6f74…) - finalized: 0x5cc0…3874:195764 - peers: 1
```

```txt
Apr-20 15:13:53.151[]                 info: Syncing - 1.6 minutes left - 3.82 slots/s - slot: 6264967 - head: (slot -360) 0xe0cf…9f3c - exec-block: valid(17088167 0x2d6a…) - finalized: 0x8f3f…2f81:195766 - peers: 5
Apr-20 15:14:05.425[]                 info: Syncing - 1.1 minutes left - 4.33 slots/s - slot: 6264968 - head: (slot -297) 0x3655…1658 - exec-block: valid(17088231 0xdafd…) - finalized: 0x9475…425a:195769 - peers: 2
Apr-20 15:14:53.001[]                 info: Syncing - 9 seconds left - 5.00 slots/s - slot: 6264972 - head: (slot -45) 0x44e4…20a4 - exec-block: valid(17088475 0xca61…) - finalized: 0x9cbd…ba83:195776 - peers: 8
```

```txt
Apr-20 15:15:01.443[network]          info: Subscribed gossip core topics
Apr-20 15:15:01.446[sync]             info: Subscribed gossip core topics
Apr-20 15:15:05.000[]                 info: Synced - slot: 6264973 - head: 0x90ea…c655 - exec-block: valid(17088521 0xca9b…) - finalized: 0x6981…682f:195778 - peers: 6
Apr-20 15:15:17.003[]                 info: Synced - slot: 6264974 - head: 0x4f7e…0e3a - exec-block: valid(17088522 0x08b1…) - finalized: 0x6981…682f:195778 - peers: 6
```

```txt
Apr-20 15:15:41.001[]                 info: Synced - slot: 6264976 - head: (slot -1) 0x17c6…71a7 - exec-block: valid(17088524 0x5bc1…) - finalized: 0x6981…682f:195778 - peers: 8
Apr-20 15:15:53.001[]                 info: Synced - slot: 6264977 - head: (slot -2) 0x17c6…71a7 - exec-block: valid(17088524 0x5bc1…) - finalized: 0x6981…682f:195778 - peers: 8
```

```txt
Apr-20 15:16:05.000[]                 info: Synced - slot: 6264978 - head: 0xc9fd…28c5 - exec-block: valid(17088526 0xb5bf…) - finalized: 0x6981…682f:195778 - peers: 8
Apr-20 15:16:17.017[]                 info: Synced - slot: 6264979 - head: 0xde91…d4cb - exec-block: valid(17088527 0xa488…) - finalized: 0x6981…682f:195778 - peers: 7
```

1. Sync status: Takes three values : `Synced` or `Syncing` (along with sync speed info) or `Searching` if node is is still looking for viable peers from where it can download blocks.

2. Slot (clock) info: What is the current ongoing slot as per the chain genesis

3. Head info: It specifies where the local chain head hash is. In case its far behind the Slot (clock) then it independently shows the head slot else it show how far behind from the Slot it is if difference < 1000.

4. Execution block info: It provides the execution information about the head whether its confirmed `valid` or execution layer is still `syncing` to it, as well as its number and a short hash to easy identification.

5. Finalized info: What is the current local `finalized` checkpoint in the format of `[checkpoint root]:[checkpoint epoch]`, for e.g.: `0xd7ba…8386:189636`

6. Peer info: Current total number of outbound or inbound peers, for e.g.: `peers: 27`

For more insight into how a Lodestar beacon node is functioning, you may setup lodestar metrics and use the prepared Grafana dashboards that are found in the repository. Check out our section on [Prometheus and Grafana](../logging-and-metrics/prometheus-grafana.md) for more details.
