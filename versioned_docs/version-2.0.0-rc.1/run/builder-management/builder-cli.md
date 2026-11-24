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

URL of the beacon node. It must run with `--emitPayloadAttributes` to emit payload attributes for every slot

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



#### `--execution.urls`

Url to the execution client engine API that builds the payloads. The execution client must be kept in sync by a beacon node

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



#### `--execution.jwtSecret`

File path to a shared hex-encoded jwt secret which will be used to generate and bundle HS256 encoded jwt tokens for authentication with the EL client's rpc server hosting engine apis. Secret to be exactly same as the one used by the corresponding EL client.

type: `string`



#### `--bidding.shareBps`

Share of the payload value offered to the proposer, in basis points

type: `number`

default: `10000`



#### `--bidding.fixedCostGwei`

Fixed amount in gwei deducted from the proposer share of every bid

type: `number`

default: `0`



#### `--bidding.minValueGwei`

Never bid below this value in gwei

type: `number`

default: `0`



#### `--bidding.maxValueGwei`

Never bid above this value in gwei

type: `number`



#### `--bidding.deadlineBps`

Point within the slot before the proposal slot at which the payload is retrieved and the bid is published, in basis points

type: `number`

default: `9500`



#### `--bidding.getPayloadTimeout`

Timeout in milliseconds for retrieving the payload from the execution client at the bid deadline

type: `number`

default: `1000`



#### `--bidding.minOperatingBalanceGwei`

Do not bid while the builder balance is below this value in gwei

type: `number`

default: `1000000000`



#### `--reveal.cutoffBps`

Do not reveal the payload if the block committing to our bid arrives after this point within its slot, in basis points. Defaults to PAYLOAD_ATTESTATION_DUE_BPS of the network

type: `number`



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

