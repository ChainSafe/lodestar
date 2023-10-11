# Data Retention

There are two components for an ethereum node database.  Both the execution client and the beacon node need to hold data for a full node to work correctly.  In particular the execution node holds state such as wallet information and smart contract code. It also holds the execution blocks with the transaction record.  The beacon node is responsible for holding beacon node blocks and state. The beacon state is responsible primarily for the validator information.

There are several processes that need to store data for Lodestar. These data sets can grow quite large over time so it is important to understand how to manage them so the host machine can support operations effectively.

```bash
$dataDir
├── $executionDir
│   └── execution-db
└── $beaconDir
    ├── beacon.config.json
    ├── peer-id.json
    ├── enr
    ├── beacon.log # there can be many of these
    ├── $dbDir
    │   ├── chain-db
    │   └── peerstore
    └── $validatorDir
        ├── validator-db
        ├── keystores
        └── keystore cache
```

## Data Management

Configuring your node to store and prune data is key to success.  On average you can expect for the database to grow by the follow amounts:

- `execution-db` grows at 1GB per month
- `chain-db` grows at 1GB per month
- `validator-db` grows at 1GB per month

`keystores`, `keystore-cache` and `peerstore` are not usually very large and are not expected to grow much during normal operation.

Logs can also become quite large so please check out the section on [log management](../logging-and-metrics/log-management.md) for more information.

There is really only one flag that is needed to manage the data for Lodestar, [`--dataDir`](./configuration.md#--dataDir).  Other than that handling log management is really the heart of the data management story. Beacon node data is what it is. Depending on the execution client that is chosen, there may be flags to help with data storage growth but that is outside the scope of this document.