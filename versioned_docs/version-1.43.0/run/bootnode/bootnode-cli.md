---
title: CLI Reference
---

# `bootnode` CLI Command



Run a discv5 bootnode. This will NOT perform any beacon node functions, rather, it will run a discv5 service that allows nodes on the network to discover one another.



## `bootnode` Options

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



#### `--listenAddress`

The IPv4 address to listen for discv5 connections

type: `string`

default: `"0.0.0.0"`



#### `--port`

The UDP port to listen on

type: `number`

default: `9000`



#### `--listenAddress6`

The IPv6 address to listen for discv5 connections

type: `string`

default: `"::"`



#### `--port6`

The UDP port to listen on

type: `number`

default: `9000`



#### `--bootnodes`

Additional bootnodes for discv5 discovery

type: `string[]`

default: `[ "[]" ]`



#### `--bootnodesFile`

Additional bootnodes for discv5 discovery file path

type: `string`



#### `--persistNetworkIdentity`

Whether to reuse the same peer-id across restarts

type: `boolean`

default: `true`



#### `--enr.ip`

Override ENR IP entry

type: `string`



#### `--enr.udp`

Override ENR UDP entry

type: `number`



#### `--enr.ip6`

Override ENR IPv6 entry

type: `string`



#### `--enr.udp6`

Override ENR (IPv6-specific) UDP entry

type: `number`



#### `--nat`

Allow ENR configuration of non-local addresses

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

