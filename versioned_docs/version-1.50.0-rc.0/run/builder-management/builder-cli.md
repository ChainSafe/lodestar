---
title: CLI Reference
---

# `builder` CLI Command



Run a builder client



## Examples

### Base `builder` command

Run builder client

```sh
./lodestar builder
```



## `builder` Options

#### `--dataDir`

Lodestar root data directory

type: `string`



#### `--network`

Name of the Ethereum Consensus chain network to join

type: `string`

choices: "mainnet", "gnosis", "sepolia", "hoodi", "plataberget", "chiado", "ephemery", "dev"

default: `"mainnet"`



#### `--paramsFile`

Network configuration file

type: `string`



#### `--rcConfig`

RC file to supplement command line args, accepted formats: .yml, .yaml, .json

type: `string`

example: Options can be written as nested maps or dotted keys

```yaml
network: hoodi
logLevel: debug
metrics:
  enabled: true
  port: 8008
```



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



#### `--beaconNodeUrl`

Url to a trusted beacon node

type: `string`

default: `"http://127.0.0.1:9596"`



#### `--keystore`

Path to a keystore file

required: true

type: `string`



#### `--keystorePassword`

Path to a file with password to decrypt the keystore from 'keystore' option

required: true

type: `string`



#### `--builderPubkey`

Builder's expected public key based on the keystore from 'keystore' option

type: `string`



#### `--executionFeeRecipient`

Execution address for receiving the payload rewards

required: true

type: `string`



#### `--requestTimeout`

Timeout in milliseconds for HTTP requests to the beacon node

type: `number`

default: `10000`



#### `--metrics`

Enable the Prometheus metrics HTTP server

type: `boolean`

default: `false`



#### `--metrics.port`

Listen TCP port for the Prometheus metrics HTTP server

type: `number`

default: `5065`



#### `--metrics.address`

Listen address for the Prometheus metrics HTTP server

type: `string`

default: `"127.0.0.1"`

