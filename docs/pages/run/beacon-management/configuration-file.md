---
title: Configuration File
---

# Configuration File

Lodestar can read any command line option from a configuration file using the global `--rcConfig` flag. This is useful for managing larger setups, keeping your configuration under version control, or avoiding long commands with many flags.

`--rcConfig` is available for all commands (`beacon`, `validator`, `bootnode`, etc.). The accepted file formats are YAML (`.yml`, `.yaml`) and JSON (`.json`).

## File Format

Each key maps to a CLI flag, written without the leading `--`, and the value uses the same type as the flag (string, number, boolean, or array). Nested options such as `--rest.address` are written as dotted keys (`rest.address`), not as nested maps.

For the full list of available options, see the [`beacon`](./beacon-cli.md), [`validator`](../validator-management/validator-cli.md), and [`bootnode`](../bootnode/bootnode-cli.md) CLI references.

```yaml
# beacon.config.yaml
network: "hoodi"
dataDir: "/data/lodestar"
logFile: "/data/lodestar/beacon.log"
jwtSecret: "/data/jwtsecret.hex"

# Networking
listenAddress: "0.0.0.0"
port: 9000

# Beacon REST API
rest: true
rest.address: "0.0.0.0"
rest.port: 9596

# Execution client
execution.urls:
  - "http://localhost:8551"

# Metrics
metrics: true
metrics.port: 8008
```

The same configuration in JSON:

```json
{
  "network": "hoodi",
  "dataDir": "/data/lodestar",
  "logFile": "/data/lodestar/beacon.log",
  "jwtSecret": "/data/jwtsecret.hex",
  "listenAddress": "0.0.0.0",
  "port": 9000,
  "rest": true,
  "rest.address": "0.0.0.0",
  "rest.port": 9596,
  "execution.urls": ["http://localhost:8551"],
  "metrics": true,
  "metrics.port": 8008
}
```

## Running with a Configuration File

Pass the file path to `--rcConfig` when starting the node:

```bash
./lodestar beacon --rcConfig /data/beacon.config.yaml
```

## Overriding Options

Options passed directly on the command line take precedence over the values in the configuration file. This lets you keep a shared base configuration and override individual values per run:

```bash
# Use everything from the file, but connect to mainnet instead of hoodi
./lodestar beacon --rcConfig /data/beacon.config.yaml --network mainnet
```
