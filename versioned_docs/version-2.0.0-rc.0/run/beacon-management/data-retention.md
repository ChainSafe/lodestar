# Data Retention

There are two components for an ethereum node database, the execution client and the beacon node. Both need to hold data for a full node to work correctly. In particular the execution node holds state such as wallet information and smart contract code. It also holds the execution blocks with the transaction record. The beacon node is responsible for holding beacon node blocks and state. The beacon state is responsible primarily for the validator information.

There are several processes that need to store data for Lodestar. These data sets can grow quite large over time so it is important to understand how to manage them so the host machine can support operations effectively.

```bash
$executionDir # this changes depending on the execution client
    └── execution-db

$dataDir # specified by --dataDir on the beacon command
├── .log_rotate_audit.json
├── beacon.log # there can be many of these
├── enr
├── peer-id.json
├── pubkeys
├── chain-db # default if --dbDir not specified
│   └── (db files)
├── data_columns # default if --dataColumnDir not specified
│   └── (data column flat files grouped by slot)
└── peerstore # default if --peerStoreDir not specified
    └── (peerstore files)

$dataDir # specified by --dataDir on the validator command
├── .log_rotate_audit.json
├── validator.log # there can be many of these
├── validator-db # default if --validatorsDbDir not specified
│   └── (db files)
├── proposerConfigs # default if --proposerDir not specified
│   └── (config files)
├── cache # default if --cacheDir not specified
│   └── (cache files)
├── secrets # default if --secretsDir not specified
│   ├── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037...
│   └── 0xa329f988c16993768299643d918a2694892c012765d896a16f...
├── keystores # default if --keystoresDir not specified
│   ├── 0x8e41b969493454318c27ec6fac90645769331c07ebc8db5037...
│   │   └── voting-keystore.json
│   └── 0xa329f988c16993768299643d918a2694892c012765d896a16f...
│       └── voting-keystore.json
└── remoteKeys # default if --remoteKeysDir not specified
    └── 0xa329f988c16993768299643d918a2694892c012765d896a16f.json
```

## Data Management

Configuring your node to store and prune data is key to success. On average you can expect for the database to grow by the follow amounts:

- `execution-db` grows at 2-30GB per week
- `chain-db` stops growing once it holds the block retention window, since history is pruned by default (see [Pruning history](#pruning-history)). It grows at 1GB per month if history is retained
- `validator-db` grows at less than 2MB per year, per key (2000 keys = 4GB per year)

`keystores`, `keystore-cache` and `peerstore` are not usually very large and are not expected to grow much during normal operation.

Logs can also become quite large so please check out the section on [log management](../logging-and-metrics/log-management.md) for more information.

Data column flat files are stored in `$dataDir/data_columns` by default. Use `--dataColumnDir` to place them on a separate volume.

[`--dataDir`](./beacon-cli#--datadir) sets where Lodestar stores its data. The beacon node prunes its own database by default, so the remaining growth to manage is logs. Execution clients have their own flags to limit storage growth, which are outside the scope of this document.

### Pruning history

By default the beacon node continually prunes all old blocks and execution payload envelopes (older than `config.MIN_EPOCHS_FOR_BLOCK_REQUESTS`, which is ~5 months on mainnet and reduced to ~2 months from gloas) and all prior finalized states. To retain historical data, set [`--chain.pruneHistory=false`](./beacon-cli#--chainprunehistory). Pruning is also disabled when `--serveHistoricalState` is set, unless `--chain.pruneHistory` is passed explicitly.

**Note:** An existing large database is pruned gradually, up to 4096 slots of blocks on startup and on every finalized checkpoint, so disk usage drops over days to weeks rather than immediately. Pruned data cannot be recovered without syncing the node again.
