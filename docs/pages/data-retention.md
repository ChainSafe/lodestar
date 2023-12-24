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
├── chain-db # default if --dbDir not specified
│   └── (db files)
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
- `chain-db` grows at 1GB per month
- `validator-db` grows at less than 2MB per year, per key (2000 keys = 4GB per year)

`keystores`, `keystore-cache` and `peerstore` are not usually very large and are not expected to grow much during normal operation.

Logs can also become quite large so please check out the section on [log management](./logging-and-metrics/log-management.md) for more information.

There is really only one flag that is needed to manage the data for Lodestar, [`--dataDir`](./beacon-management/beacon-cli.md#-datadir). Other than that handling log management is really the heart of the data management story. Beacon node data is what it is. Depending on the execution client that is chosen, there may be flags to help with data storage growth but that is outside the scope of this document.
