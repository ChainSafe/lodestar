---
title: CLI Reference
---

# `validator` CLI Command



Run one or multiple validator clients



## Available Sub-Commands

The following sub-commands are available with the `validator` command:

- [validator slashing-protection import](#validator-slashing-protection-import)

- [validator slashing-protection export](#validator-slashing-protection-export)

- [validator import](#validator-import)

- [validator list](#validator-list)

- [validator voluntary-exit](#validator-voluntary-exit)

- [validator bls-to-execution-change](#validator-bls-to-execution-change)



## Examples

### Base `validator` command

Run one validator client with all the keystores available in the directory .hoodi/keystores

```sh
./lodestar validator --network hoodi
```



## `validator` Options

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



#### `--keymanager`

Enable key manager API server

type: `boolean`



#### `--keymanager.auth`

Enable token bearer authentication for key manager API server

type: `boolean`

default: `true`



#### `--keymanager.tokenFile`

Path to file containing bearer token used for key manager API authentication

type: `string`



#### `--keymanager.port`

Set port for key manager API

type: `number`

default: `5062`



#### `--keymanager.address`

Set host for key manager API

type: `string`

default: `"127.0.0.1"`



#### `--keymanager.cors`

Configures the Access-Control-Allow-Origin CORS header for key manager API. Use 'all' to allow all origins

type: `string`

default: `"*"`



#### `--beaconNodes`

Addresses to connect to BeaconNode

type: `string[]`

default: `[ "http://127.0.0.1:9596" ]`



#### `--force`

Open validators even if there's a lockfile. Use with caution

type: `boolean`



#### `--graffiti`

Specify your custom graffiti to be included in blocks (plain UTF8 text, 32 characters max)

type: `string`



#### `--proposerSettingsFile`

A yaml file to specify detailed default and per validator public key customized proposer configs. PS: This feature and its format is in alpha and subject to change

type: `string`



#### `--suggestedFeeRecipient`

Specify fee recipient default for collecting the EL block fees and rewards (a hex string representing 20 bytes address: ^0x[a-fA-F0-9]&#123;40&#125;$). It would be possible (WIP) to override this per validator key using config or key manager API. Only used post merge.

type: `string`

default: `"0x0000000000000000000000000000000000000000"`



#### `--strictFeeRecipientCheck`

Enable strict checking of the validator's `feeRecipient` with the one returned by engine

type: `boolean`



#### `--defaultGasLimit`

Suggested gas limit to the engine/builder for building execution payloads. Only used post merge.

type: `number`

default: `60000000`



#### `--builder`

An alias for `--builder.selection default` for the builder flow, ignored if `--builder.selection` is explicitly provided

type: `boolean`



#### `--builder.selection`

Builder block selection strategy `default`, `maxprofit`, `builderalways`, `builderonly`, `executionalways`, or `executiononly`

type: `string`

default: `"executiononly"`



#### `--builder.boostFactor`

Percentage multiplier the block producing beacon node must apply to boost (&gt;100) or dampen (&lt;100) builder block value for selection against execution block. The multiplier is ignored if `--builder.selection` is set to anything other than `maxprofit`

type: `string`

default: `"100"`



#### `--broadcastValidation`

Validations to be run by beacon node for the signed block prior to publishing

type: `string`

default: `"gossip"`



#### `--blindedLocal`

Request fetching local block in blinded format for produceBlockV3

type: `boolean`

default: `false`



#### `--importKeystores`

Path(s) to a directory or single file path to validator keystores, i.e. Launchpad validators

type: `string[]`

default: `[ "./keystores/*.json" ]`



#### `--importKeystoresPassword`

Path to a file with password to decrypt all keystores from `importKeystores` option

type: `string`

default: `"./password.txt"`



#### `--doppelgangerProtection`

Enables Doppelganger protection

type: `boolean`



#### `--http.requestWireFormat`

Wire format to use in HTTP requests to beacon node. Can be one of `json` or `ssz`

type: `string`

default: `"json"`



#### `--http.responseWireFormat`

Preferred wire format for HTTP responses from beacon node. Can be one of `json` or `ssz`

type: `string`

default: `"ssz"`



#### `--externalSigner.url`

URL to connect to an external signing server

type: `string`



#### `--externalSigner.pubkeys`

List of validator public keys used by an external signer. May also provide a single string of comma-separated public keys

type: `string[]`



#### `--externalSigner.fetch`

Fetch the list of public keys to validate from an external signer. Cannot be used in combination with `--externalSigner.pubkeys`

type: `boolean`



#### `--externalSigner.fetchInterval`

Interval in milliseconds between fetching the list of public keys from external signer, once per epoch by default

type: `number`



#### `--distributed`

Enables specific features required to run as part of a distributed validator cluster

type: `boolean`



#### `--metrics`

Enable the Prometheus metrics HTTP server

type: `boolean`

default: `false`



#### `--metrics.port`

Listen TCP port for the Prometheus metrics HTTP server

type: `number`

default: `5064`



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





## `validator slashing-protection import`

Import an interchange file.

### `validator slashing-protection import` Options

_Supports all parent command options plus the following:_



#### `--beaconNodes`

Addresses to connect to BeaconNode

type: `string[]`

default: `[ "http://127.0.0.1:9596" ]`



#### `--force`

If `genesisValidatorsRoot` can't be fetched from the Beacon node, use a zero hash

type: `boolean`



#### `--file`

The slashing protection interchange file to import (.json).

required: true

type: `string`





## `validator slashing-protection export`

Export an interchange file.

### `validator slashing-protection export` Options

_Supports all parent command options plus the following:_



#### `--beaconNodes`

Addresses to connect to BeaconNode

type: `string[]`

default: `[ "http://127.0.0.1:9596" ]`



#### `--force`

If `genesisValidatorsRoot` can't be fetched from the Beacon node, use a zero hash

type: `boolean`



#### `--file`

The slashing protection interchange file to export to (.json).

required: true

type: `string`



#### `--pubkeys`

Export slashing protection data only for a given subset of public keys

type: `string[]`





## `validator import`

Imports one or more EIP-2335 keystores into a Lodestar validator client directory, requesting passwords interactively. The directory flag provides a convenient method for importing a directory of keys generated by the eth2-deposit-cli Ethereum Foundation utility.

### `validator import` Examples

Import validator keystores generated with the Ethereum Foundation Staking Launchpad

```sh
./lodestar validator import --network hoodi --importKeystores $HOME/staking-deposit-cli/validator_keys
```

### `validator import` Options

_Supports all parent command options plus the following:_



#### `--importKeystores`

Path(s) to a directory or single file path to validator keystores, i.e. Launchpad validators

type: `string[]`

default: `[ "./keystores/*.json" ]`



#### `--importKeystoresPassword`

Path to a file with password to decrypt all keystores from `importKeystores` option

type: `string`

default: `"./password.txt"`





## `validator list`

Lists the public keys of all validators

### `validator list` Examples

List all validator public keys previously imported

```sh
./lodestar validator list
```



## `validator voluntary-exit`

Performs a voluntary exit for a given set of validators as identified via `pubkeys`. If no `pubkeys` are provided, it will exit all validators that have been imported.

### `validator voluntary-exit` Examples

Perform a voluntary exit for the validator who has a public key 0xF00

```sh
./lodestar validator voluntary-exit --network hoodi --pubkeys 0xF00
```

Perform a voluntary exit for the validator who has a public key 0xF00 and its secret key is on an external signer

```sh
./lodestar validator voluntary-exit --network hoodi --externalSigner.url http://signer:9000 --externalSigner.fetch --pubkeys 0xF00
```

### `validator voluntary-exit` Options

_Supports all parent command options plus the following:_



#### `--exitEpoch`

The epoch upon which to submit the voluntary exit.  If no value is provided, then we default to the current epoch.

type: `number`



#### `--pubkeys`

Public keys to exit

type: `string[]`



#### `--yes`

Skip confirmation prompt

type: `boolean`





## `validator bls-to-execution-change`

Performs BLS To Execution Change for a given validator (as identified via `publicKey`.  If no `publicKey` is provided, a prompt will ask the user which validator they would like to choose for BLS To Execution Change.

### `validator bls-to-execution-change` Examples

Perform BLS To Execution Change for the validator who has a public key 0xF00

```sh
./lodestar validator bls-to-execution-change --publicKey 0xF00 --fromBlsPrivkey ... --toExecutionAddress ...
```

### `validator bls-to-execution-change` Options

_Supports all parent command options plus the following:_



#### `--publicKey`

Validator public key for which to set withdrawal address hence enabling withdrawals

required: true

type: `string`



#### `--fromBlsPrivkey`

Bls withdrawals private key to sign the message

required: true

type: `string`



#### `--toExecutionAddress`

Address to which the validator's balances will be set to be withdrawn.

required: true

type: `string`

