---
title: CLI Reference
---

# `beacon` CLI Command



Run a beacon chain node



## Examples

Run a beacon chain node and connect to the hoodi testnet

```sh
./lodestar beacon --network hoodi
```



## `beacon` Options

#### `--dataDir`

Lodestar root data directory

type: `string`



#### `--network`

Name of the Ethereum Consensus chain network to join

type: `string`

choices: "mainnet", "gnosis", "sepolia", "hoodi", "chiado", "ephemery", "dev"

default: `"mainnet"`



#### `--paramsFile`

Network configuration file

type: `string`



#### `--rcConfig`

RC file to supplement command line args, accepted formats: .yml, .yaml, .json

type: `string`



#### `--supernode`

Subscribe to and custody all data column sidecar subnets

type: `boolean`



#### `--semiSupernode`

Subscribe to and custody half of the data column sidecar subnets to support blob reconstruction, enabling more efficient data availability with lower bandwidth and storage requirements compared to a supernode.

type: `boolean`



#### `--genesisStateFile`

Path or URL to download a genesis state file in ssz-encoded format

type: `string`



#### `--checkpointSyncUrl`

Server url hosting Beacon Node APIs to fetch weak subjectivity state. Fetch latest finalized by default, else set --wssCheckpoint

type: `string`



#### `--checkpointState`

File path or url to finalized checkpoint state to start syncing from

type: `string`



#### `--wssCheckpoint`

Start beacon node off a state at the provided weak subjectivity checkpoint, to be supplied in &lt;blockRoot&gt;:&lt;epoch&gt; format. For example, 0x1234:100 will sync and start off from the weak subjectivity state at checkpoint of epoch 100 with block root 0x1234.

type: `string`



#### `--forceCheckpointSync`

Force syncing from checkpoint state even if db state is within weak subjectivity period. This helps to avoid long sync times after node has been offline for a while.

type: `boolean`



#### `--ignoreWeakSubjectivityCheck`

Ignore the checkpoint sync state failing the weak subjectivity check. This is relevant in testnets where the weak subjectivity period is too small for even few epochs of non finalization causing last finalized to be out of range. This flag is not recommended for mainnet use.

type: `boolean`



#### `--persistNetworkIdentity`

Whether to reuse the same peer-id across restarts. Validator custody requires custody group count to persist relative to a given ENR. Setting to false will reset ENR and validator custody requirements on restarts.

type: `boolean`

default: `true`



#### `--private`

Do not send implementation details over p2p identify protocol, and in builder and execution engine requests

type: `boolean`



#### `--validatorMonitorLogs`

Log validator monitor events as info.

type: `boolean`



#### `--disableLightClientServer`

Disable light client server.

type: `boolean`



#### `--logLevel`

Logging verbosity level for emitting logs to terminal

type: `string`

choices: "error", "warn", "info", "verbose", "debug", "trace"

default: `"info"`



#### `--logFile`

Path to output all logs to a persistent log file, use 'none' to disable

type: `string`



#### `--logFileLevel`

Logging verbosity level for emitting logs to file

type: `string`

choices: "error", "warn", "info", "verbose", "debug", "trace"

default: `"debug"`



#### `--logFileDailyRotate`

Daily rotate log files, set to an integer to limit the file count, set to 0 (zero) to disable rotation

type: `number`

default: `5`



#### `--rest`

Enable/disable HTTP API

type: `boolean`

default: `true`



#### `--rest.namespace`

Pick namespaces to expose for HTTP API. Set to 'all' (or '*') to enable all namespaces

type: `string[]`

choices: "beacon", "config", "debug", "events", "lightclient", "lodestar", "node", "proof", "validator", "*", "all"

default: `["beacon","config","debug","events","node","validator","lightclient"]`



#### `--rest.cors`

Configures the Access-Control-Allow-Origin CORS header for HTTP API. Use 'all' to allow all origins

type: `string`

default: `"*"`



#### `--rest.address`

Set host for HTTP API

type: `string`

default: `"127.0.0.1"`



#### `--rest.port`

Set port for HTTP API

type: `number`

default: `9596`



#### `--rest.swaggerUI`

Enable Swagger UI for API exploration at http://&#123;address&#125;:&#123;port&#125;/documentation

type: `boolean`



#### `--suggestedFeeRecipient`

Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]&#123;40&#125;$) in case validator fails to update for a validator index before calling `produceBlock`.

type: `string`

default: `"0x0000000000000000000000000000000000000000"`



#### `--emitPayloadAttributes`

Flag to SSE emit execution `payloadAttributes` before every slot

type: `boolean`

default: `false`



#### `--serveHistoricalState`

Regenerate finalized beacon states on demand and serve them via the REST API (e.g. `/eth/v2/debug/beacon/states/{state_id}`). Does not backfill historical data, only states the node already has (since genesis sync or `--checkpointState`) can be regenerated. Regeneration cost depends on `--chain.archiveStateEpochFrequency` and may affect validator performance.

type: `boolean`



#### `--chain.archiveStateEpochFrequency`

Minimum number of epochs between archived states

type: `number`

default: `1024`



#### `--chain.archiveDataEpochs`

Number of epochs to retain finalized blobs/columns (minimum of MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS/MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS)

type: `number`



#### `--chain.pruneHistory`

Continually prune finalized blocks older than `MIN_EPOCHS_FOR_BLOCK_REQUESTS` (33024 epochs / ~5 months on mainnet) and all archived states before the finalized epoch. This is useful to minimize disk usage when the node does not need to serve historical data. Initial pruning may be slow on first startup with an existing large database.

type: `boolean`



#### `--execution.urls`

Urls to execution client engine API

type: `string[]`

default: `[ "http://localhost:8551" ]`



#### `--execution.timeout`

Timeout in milliseconds for execution engine API HTTP client

type: `number`

default: `12000`



#### `--execution.retries`

Number of retries when calling execution engine API

type: `number`

default: `2`



#### `--execution.retryDelay`

Delay time in milliseconds between retries when retrying calls to the execution engine API

type: `number`

default: `2000`



#### `--execution.engineMock`

Set the execution engine to mock mode (development only)

type: `boolean`



#### `--jwtSecret`

File path to a shared hex-encoded jwt secret which will be used to generate and bundle HS256 encoded jwt tokens for authentication with the EL client's rpc server hosting engine apis. Secret to be exactly same as the one used by the corresponding EL client.

type: `string`



#### `--jwtId`

An optional identifier to be set in the id field of the claims included in jwt tokens used for authentication with EL client's rpc server hosting engine apis

type: `string`



#### `--builder`

Enable external builder

type: `boolean`



#### `--builder.url`

Url hosting the builder API

type: `string`

default: `"http://localhost:8661"`



#### `--builder.timeout`

Timeout in milliseconds for builder API HTTP client

type: `number`

default: `12000`



#### `--builder.faultInspectionWindow`

Window to inspect missed slots for enabling/disabling builder circuit breaker

type: `number`



#### `--builder.allowedFaults`

Number of missed slots allowed in the `faultInspectionWindow` for builder circuit

type: `number`



#### `--metrics`

Enable the Prometheus metrics HTTP server

type: `boolean`



#### `--metrics.port`

Listen TCP port for the Prometheus metrics HTTP server

type: `number`

default: `8008`



#### `--metrics.address`

Listen address for the Prometheus metrics HTTP server

type: `string`

default: `"127.0.0.1"`



#### `--monitoring.endpoint`

Enables monitoring service for sending clients stats to the specified endpoint of a remote service (e.g. beaconcha.in)

type: `string`



#### `--monitoring.interval`

Interval in milliseconds between sending client stats to the remote service

type: `number`

default: `60000`



#### `--discv5`

Enable discv5

type: `boolean`

default: `true`



#### `--listenAddress`

The IPv4 address to listen for p2p UDP and TCP connections

type: `string`

default: `"0.0.0.0"`



#### `--port`

The TCP/UDP port to listen on. The UDP port can be modified by the --discoveryPort flag.

type: `number`

default: `9000`



#### `--discoveryPort`

The UDP port that discovery will listen on. Defaults to `port`

type: `number`

default: `port`



#### `--quicPort`

The UDP port that QUIC will listen on. Defaults to `port` + 1

type: `number`

default: `port + 1`



#### `--listenAddress6`

The IPv6 address to listen for p2p UDP and TCP connections

type: `string`

default: `"::"`



#### `--port6`

The TCP/UDP port to listen on. The UDP port can be modified by the --discoveryPort6 flag.

type: `number`

default: `9000`



#### `--discoveryPort6`

The UDP port that discovery will listen on. Defaults to `port6`

type: `number`

default: `port6`



#### `--quicPort6`

The UDP port that QUIC will listen on. Defaults to `port6` + 1

type: `number`

default: `port6 + 1`



#### `--bootnodes`

Bootnodes for discv5 discovery

type: `string[]`

default: `[ "[]" ]`



#### `--targetPeers`

The target connected peers. Above this number peers will be disconnected

type: `number`

default: `200`



#### `--subscribeAllSubnets`

Subscribe to all subnets regardless of validator count

type: `boolean`

default: `false`



#### `--disablePeerScoring`

Disable peer scoring, used for testing on devnets

type: `boolean`

default: `false`



#### `--quic`

Enable QUIC transport

type: `boolean`

default: `true`



#### `--mdns`

Enable mdns local peer discovery

type: `boolean`

default: `false`



#### `--directPeers`

Direct peers for GossipSub mesh. These peers maintain permanent connections without GRAFT/PRUNE. Supports multiaddr with peer ID (e.g., `/ip4/192.168.1.1/tcp/9000/p2p/16Uiu2HAmKLhW7...`) or ENR (e.g., `enr:-IS4QHCYrYZbAKWCBRlAy5zzaDZXJBGkcnh4MHcBFZntXNFrdvJjX04jRzjzCBOo...`). Both peers must configure each other as direct peers for the feature to work properly.

type: `string[]`

default: `[ "[]" ]`



#### `--enr.ip`

Override ENR IP entry

type: `string`



#### `--enr.tcp`

Override ENR TCP entry

type: `number`



#### `--enr.udp`

Override ENR UDP entry

type: `number`



#### `--enr.quic`

Override ENR QUIC entry

type: `number`



#### `--enr.ip6`

Override ENR IPv6 entry

type: `string`



#### `--enr.tcp6`

Override ENR (IPv6-specific) TCP entry

type: `number`



#### `--enr.udp6`

Override ENR (IPv6-specific) UDP entry

type: `number`



#### `--enr.quic6`

Override ENR (IPv6-specific) QUIC entry

type: `number`



#### `--nat`

Allow configuration of non-local addresses

type: `boolean`

