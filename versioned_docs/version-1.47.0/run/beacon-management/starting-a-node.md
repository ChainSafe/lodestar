---
title: Starting a Node
---

# Beacon Management

Running a Lodestar node on mainnet or a testnet only requires basic familiarity with the terminal. The following instructions are required to configure and run the Lodestar beacon node. This page assumes you have already setup an Ethereum execution client.

## Connect to Mainnet or a Public Testnet

Make sure Lodestar is installed in your local environment, following the chosen [Installation](../getting-started/installation.md) method. The following command should return a non-error message.

```bash
./lodestar --help
```

For a complete list of beacon node CLI commands and options, see the [`beacon` CLI Command](../beacon-management/beacon-cli.md) section.

To select a known testnet or mainnet, use the `--network` flag. The option `mainnet` is selected by default, and a list of available networks is listed with the `--help` flag. Setting the `--network` flag will conveniently configure the beacon node for the selected network. For power users, any configuration option should be able to be overridden.

## Configure the Lodestar JWT Authentication Token

Ethereum requires a [secure authentication with the Engine API](https://github.com/ethereum/execution-apis/blob/main/src/engine/authentication.md) for connecting to your chosen execution client on port 8551.

### Generate a Secret Key

You must generate a secret 32-byte (64 characters) hexadecimal string that will be used to authenticate with an execution node. You can use the following command in most terminals to generate a random secret: `openssl rand -hex 32`. Or you can use an [online generator](https://codebeautify.org/generate-random-hexadecimal-numbers). Save this secret key into a text file and note where you store this file.

### Configure Lodestar to Locate the JWT Secret

When starting up a Lodestar beacon node in any configuration, ensure you add the `--jwtSecret $JWT_SECRET_PATH` flag to point to the saved secret key file.

### Configure the Execution Client with the JWT Secret

**For Go Ethereum:**
Use the `--authrpc.jwtsecret /path/to/jwtsecret.hex` flag to configure the secret. Use their documentation [here](https://geth.ethereum.org/docs/getting-started#start-geth).

**For Nethermind:**
Use the `--JsonRpc.JwtSecretFile /path/to/jwtsecret.hex` flag to configure the secret. Use their documentation [here](https://docs.nethermind.io/get-started/consensus-clients/#configuring-json-rpc-interface).

**For Besu:**
Use the `--engine-jwt-secret=/path/to/jwtsecret.hex` flag to configure the secret. Use their documentation [here](https://besu.hyperledger.org/public-networks/how-to/use-besu-api/authenticate#2-create-the-jwt).

**For Erigon:**
Use the `--authrpc.jwtsecret /path/to/jwtsecret.hex` flag to configure the secret. Use their documentation [here](https://github.com/ledgerwatch/erigon?tab=readme-ov-file#beacon-chain-consensus-layer).

**For Reth:**
Use the `--authrpc.jwtsecret /path/to/jwtsecret.hex` flag to configure the secret. Use their documentation [here](https://reth.rs/run/mainnet.html?highlight=jwt#running-the-reth-node).

## Run the Beacon Node

To start the Lodestar beacon, run the command:

```bash
./lodestar beacon --network $NETWORK_NAME --jwtSecret $JWT_SECRET_PATH
```

This will assume an execution client is available at the default location of `https://localhost:8545`.

If the execution clients are available at different locations, use the flag `--execution.urls` to specify these locations in the command:

```bash
./lodestar beacon --network $NETWORK_NAME --jwtSecret $JWT_SECRET_PATH --execution.urls $EL_URL1 $EL_URL2
```

Your initial logs should confirm that the node has started.

```txt
Jul-31 13:35:27.967[]                 info: Lodestar network=mainnet, version=v1.21.0/ff35faa, commit=ff35faae4ad1697b86d708a0367a95a71648ab6e
Jul-31 13:35:28.344[]                 info: Connected to LevelDB database path=/data/lodestar/chain-db
Jul-31 13:35:49.828[]                 info: Initializing beacon from a valid db state slot=9633504, epoch=301047, stateRoot=0xfa2845a6877b98555906a1654941c97d9c05bdd41e61cc0870a967dc9030b156, isWithinWeakSubjectivityPeriod=true
Jul-31 13:35:51.955[chain]            info: Historical state worker started
Jul-31 13:35:51.969[eth1]             info: Eth1 provider urls=http://localhost:8551
Jul-31 13:35:51.975[execution]        info: Execution client urls=http://localhost:8551
Jul-31 13:35:51.977[]                 info: External builder url=http://localhost:8661
Jul-31 13:36:21.128[network]          info: running libp2p instance in worker thread
Jul-31 13:36:21.727[network]          info: libp2p worker started peer=15Uiu2HAmACcmCEXcgt3zCtJL2rqJZ2Mvdjh6U6fe26HgD2FoNRwW
Jul-31 13:36:27.677[network]          info: discv5 worker started peerId=16Uiu2HAmACcmCEXcgt3zCtJL2rqJZ2Mvdjh6U6fe26HgD2FoNRwW, initialENR=enr:-IO4QHGTUd1Zg8LAhUAioOz_ySTKoJLIOa6zltSP_AvvhTFVYw6M6YB35IxsiKxQG7nUgCpUB5SIsNxMntCNlTK9sMEBgmlkgnY0iXNlY3AyNTZrMaEC24cdmzuGnWqSwF-8Hw2gbkAZDzMWW3LsHJfp_kDhy-GDdGNwgiMog3VkcIIeWH, bindAddr4=/ip4/0.0.0.0/udp/9000
Jul-31 13:36:28.134[network]          info: PeerId 16Uiu2HAmACcmCEXcgt3zCtJL2rqJZ2Mvdjh6U6fe26HgD2FoNRwW, Multiaddrs /ip4/0.0.0.0/tcp/9000
Jul-31 13:36:28.137[metrics]          info: Started metrics HTTP server address=http://127.0.0.1:8008
Jul-31 13:36:28.256[rest]             info: Started REST API server address=http://0.0.0.0:9596
Jul-31 13:36:28.257[]                 info: Searching peers - peers: 0 - slot: 9634080 - head: (slot -576) 0x9d88…d02a - exec-block: syncing(20426302 0xcec4…) - finalized: 0x7feb…c130:301045
Jul-31 13:36:36.461[execution]        info: Execution client is synced oldState=ONLINE, newState=SYNCED
Jul-31 13:36:53.019[]                 info: Syncing - 3.7 minutes left - 2.32 slots/s - slot: 9634082 - head: (slot -515) 0x792f…f8aa - exec-block: valid(20426365 0x58b1…) - finalized: 0x9d88…d02a:301047 - peers: 11
Jul-31 13:38:53.168[]                 info: Syncing - 11 seconds left - 4.01 slots/s - slot: 9634092 - head: (slot -44) 0x7491…f63e - exec-block: valid(20426841 0xd4b2…) - finalized: 0x1e00…6e6b:301062 - peers: 59
Jul-31 13:38:58.051[network]          info: Subscribed gossip core topics
Jul-31 13:38:58.132[sync]             info: Subscribed gossip core topics
Jul-31 13:39:05.001[]                 info: Synced - slot: 9634093 - head: 0x35de…1f0e - exec-block: valid(20426886 0x10ff…) - finalized: 0x88f8…5375:301063 - peers: 70
Jul-31 13:39:17.000[]                 info: Synced - slot: 9634094 - head: 0x7844…3b3e - exec-block: valid(20426887 0x67d1…) - finalized: 0x88f8…5375:301063 - peers: 69
Jul-31 13:39:29.000[]                 info: Synced - slot: 9634095 - head: 0x5516…ba12 - exec-block: valid(20426888 0x4ceb…) - finalized: 0x88f8…5375:301063 - peers: 74
```

:::info
If your node is stuck with `Searching peers`, review your network configuration to make sure your ports are open and forwarded to your host machine.
:::

By default, Lodestar stores all configuration and chain data at the path `$XDG_DATA_HOME/lodestar/$NETWORK_NAME`.

A young testnet should take a few hours to sync. If you see multiple or consistent errors in the logs, please open a [Github issue](https://github.com/ChainSafe/lodestar/issues/new/choose) or reach out to us in [Discord](https://discord.gg/yjyvFRP). By reporting anomalies, you are helping to accelerate the progress of Ethereum consensus and we thank you for contributing!

:::warning
It is dangerous to expose your Beacon or Execution APIs publicly as there is no default authentication mechanism provided. Ensure your beacon node host is not exposing ports 8545 or 9596 outside of your internal network.
:::

### Checkpoint Sync

If you are starting your node from a blank database, or from a last saved database state that is too old (outside of the weak subjectivity period), your node will be susceptible to "long range attacks." Ethereum's solution to this attack is via something called weak subjectivity. [Read Vitalik's illuminating post explaining weak subjectivity.](https://blog.ethereum.org/2014/11/25/proof-stake-learned-love-weak-subjectivity/).

If you have a synced beacon node available (e.g., your friend's node or a trusted infrastructure provider) to serve a trusted checkpoint you can rely on, you can start syncing your beacon node from that available checkpoint with the flag `--checkpointSyncUrl` and passing in the URL of the checkpoint provider. This will allow your beacon node to sync within minutes rather than several days.

The Ethereum community has maintained a set of [public beacon chain checkpoints](https://eth-clients.github.io/checkpoint-sync-endpoints/) that serve these sync endpoints to the larger community. You can correlate the state root and the block root with more than one provider to verify the checkpoints being served follow the same canonical chain.

Just supply these **extra arguments** to your beacon node command:

```bash
--checkpointSyncUrl <synced node url> [--wssCheckpoint <trusted checkpoint in root:epoch format>]
```

In case you really trust the `--checkpointSyncUrl` provider, then you may skip providing `--wssCheckpoint`, which will then result into your beacon node syncing and starting off the recently finalized state from the trusted URL.

:::warning
Please be aware that a malicious checkpoint sync server URL can put you on the wrong chain with a danger of you losing your funds by social engineering.
If possible, validate your `wssCheckpoint` state from multiple places (e.g. different client distributions) or from other trusted sources. This will highly reduce the risk of starting off on a malicious chain. This list of [public endpoints](https://eth-clients.github.io/checkpoint-sync-endpoints/) maintained by the Ethereum community may be used for reference.
:::

#### Still Taking Long to Sync?

After your node has been offline for a while, it might be the case that it takes a long time to sync even though a `--checkpointSyncUrl` is specified.
This is due to the fact that the last database state is still within the weak subjectivity period (~15 days on mainnet) which causes the node
to sync from the database state instead of the checkpoint state.

It is possible to force syncing from a checkpoint state by supplying the `--forceCheckpointSync` flag. This option is only recommended if it is absolutely
necessary for the node to be synced right away to fulfill its duties as there is an inherent risk each time the state is obtained from an external source.

### Sync Log Guide

The Lodestar beacon sync log aims to provide information of utmost importance about the state of your node and be succinct at the same time. You may see the sync logs in the following format:

`[Sync status] - [ Slot info ] - [Head info] - [Execution block info] - [Finalized info] - [Peers info]`

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

1. Sync status: This status takes three values:

- `Synced`: The node is currently synced
- `Syncing` The node is currently in the syncing process
- `Searching`: The node is is still looking for viable peers from where it can download blocks

2. Slot (clock) info: The current ongoing slot as per the chain genesis

3. Head info: Specifies where the local beacon chain head hash is. In case it's far behind the Slot (clock), then it independently shows the head slot. Else, it will show how far behind the node is from the Slot (if the difference is < 1000)

4. Execution block info: Provides the information about the execution block head, whether its confirmed `valid` or still `syncing` to it. In parenthesis, it shows the current execution block number and a short hash for easy identification

5. Finalized info: Shows the current local `finalized` checkpoint in the format of `[checkpoint root]:[checkpoint epoch]`. For example: `0xd7ba…8386:189636` shows a checkpoint root of `0xd7ba…8386` in epoch `189636`

6. Peer info: Current total number of outbound and inbound peers

For more insight into how a Lodestar beacon node is functioning, you may setup Lodestar metrics with the `--metrics` flag and use the prepared Grafana dashboards that are found in the repository. Check out our section on [Prometheus and Grafana](../logging-and-metrics/prometheus-grafana.md) for more details.
