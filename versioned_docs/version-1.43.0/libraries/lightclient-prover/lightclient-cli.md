---
title: CLI Reference
---

# `lightclient` CLI Command



Run lightclient



## Examples

Run lightclient with hoodi network

```sh
./lodestar lightclient --network hoodi
```



## `lightclient` Options

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



#### `--beaconApiUrl`

Url to a beacon node that support lightclient API

required: true

type: `string`



#### `--checkpointRoot`

Checkpoint root hex string to sync the lightclient from, start with 0x

required: true

type: `string`

