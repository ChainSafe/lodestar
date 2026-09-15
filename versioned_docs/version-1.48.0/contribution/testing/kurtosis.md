# Kurtosis Scripts for Lodestar

This directory contains scripts and configurations for running Lodestar testnets using [Kurtosis](https://www.kurtosis.com/).

## Prerequisites

1. Install Kurtosis: https://docs.kurtosis.com/install
2. Install Docker: https://docs.docker.com/get-docker/

## Quick Start

From the Lodestar root directory:

```bash
# Start a testnet (automatically builds local Docker image)
./scripts/kurtosis/run.sh start

# View running services and find service names
kurtosis enclave inspect lodestar-testnet

# List just the service names
kurtosis enclave inspect lodestar-testnet | grep -E "cl-|el-|vc-" | grep RUNNING

# Check logs of a specific service (use actual service name from above)
# Note: Service names follow pattern: cl-<number>-<client>-<execution-client>
# For Lodestar nodes, this will be cl-3-lodestar-geth, cl-4-lodestar-geth, etc.
./scripts/kurtosis/run.sh logs cl-3-lodestar-geth

# Follow logs in real-time
./scripts/kurtosis/run.sh logs cl-3-lodestar-geth --follow

# Stop and clean up the testnet
./scripts/kurtosis/run.sh stop

# Force clean up (if stop fails)
./scripts/kurtosis/run.sh clean
```

Or change to the kurtosis directory first:

```bash
cd scripts/kurtosis/

# Start a testnet
./run.sh start

# Find service names
kurtosis enclave inspect lodestar-testnet | grep RUNNING

# Check logs (replace with actual service name)
./run.sh logs cl-3-lodestar-geth

# Stop
./run.sh stop
```

**Note:** The `start` command automatically builds a fresh Docker image from your local Lodestar code before starting the testnet.

## Advanced Usage

### Custom Configuration

```bash
# Create a custom config
cp lodestar.yaml my-custom-config.yaml
# Edit my-custom-config.yaml

# Run with custom config
./run.sh start my-custom-config.yaml
```

### Port Forwarding

Access services running inside Kurtosis:

```bash
# Forward Grafana dashboard
./run.sh port-forward grafana 3000

# Forward Lodestar REST API
./run.sh port-forward cl-1-lodestar 9596
```

### Custom Enclave Name

Run multiple testnets simultaneously:

```bash
./run.sh -e testnet-1 start
./run.sh -e testnet-2 start config-2.yaml
```

## Troubleshooting

### Finding Service Names

The testnet runs multiple services. To find the correct service name for logs:

```bash
# Show all services with their names
kurtosis enclave inspect lodestar-testnet | grep -A 1 "User Services" | grep -E "cl-|el-|vc-"

# Example output:
# cl-1-lighthouse-geth  (Lighthouse consensus client)
# cl-2-lighthouse-geth  (Lighthouse consensus client)
# cl-3-lodestar-geth   (Lodestar consensus client)
# cl-4-lodestar-geth   (Lodestar consensus client)
# el-1-geth-lighthouse (Geth execution client)
# el-2-geth-lighthouse (Geth execution client)
```

Service naming pattern:

- `cl-` = Consensus Layer
- `el-` = Execution Layer
- `vc-` = Validator Client
- Format: `<layer>-<number>-<client>-<paired-client>`

### Check Service Status

```bash
kurtosis service inspect lodestar-testnet <service-name>
```

### Debug Failed Services

```bash
# Check logs of a failed service
kurtosis service logs lodestar-testnet <service-name>

# Get a shell inside a service container
kurtosis service shell lodestar-testnet <service-name>
```

### Clean Up Stuck Enclaves

```bash
# Force remove an enclave
kurtosis enclave rm -f lodestar-testnet

# Remove all enclaves
kurtosis clean -a
```

## Configuration Options

The configuration files use the [ethereum-package](https://github.com/ethpandaops/ethereum-package) format. Key options include:

- `participants`: Define execution and consensus layer nodes
- `network_params`: Network configuration (preset, fork epochs, etc.)
- `additional_services`: Enable monitoring, transaction spammers, etc.

See the [ethereum-package documentation](https://github.com/ethpandaops/ethereum-package) for all available options.

## Examples

### Minimal Testnet

```yaml
participants:
  - el_type: geth
    count: 1
  - cl_type: lodestar
    count: 1
    validator_count: 32

network_params:
  preset: minimal
```

### Multi-Client Testnet

```yaml
participants:
  - el_type: geth
    count: 2
  - el_type: besu
    count: 1
  - cl_type: lodestar
    count: 2
  - cl_type: lighthouse
    count: 1
    validator_count: 32

network_params:
  preset: mainnet
```

### Testnet with Custom Lodestar Flags

```yaml
participants:
  - el_type: geth
    count: 2
  - cl_type: lodestar
    cl_image: chainsafe/lodestar:latest
    count: 2
    cl_extra_params:
      - "--metrics"
      - "--metrics.port=8008"
      - "--network.subscribeAllSubnets"
    validator_count: 32
```
