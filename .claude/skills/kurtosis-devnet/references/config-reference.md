# Kurtosis ethereum-package Config Reference

Full documentation: https://github.com/ethpandaops/ethereum-package

## Participant Fields

```yaml
participants:
  - el_type: reth|geth|nethermind|besu|erigon
    el_image: <docker-image>            # e.g., ghcr.io/paradigmxyz/reth:latest
    el_extra_params: []                  # extra CLI flags for EL
    el_log_level: ""                     # per-participant EL log level
    cl_type: lodestar|lighthouse|prysm|teku|nimbus|grandine
    cl_image: <docker-image>            # e.g., lodestar:custom or chainsafe/lodestar:latest
    cl_extra_params: []                  # extra CLI flags for CL beacon
    cl_log_level: ""                     # per-participant CL log level
    vc_type: <same-as-cl_type>          # defaults to cl_type
    vc_image: <docker-image>            # custom VC image (if different from CL)
    vc_extra_params: []                 # extra CLI flags for VC
    supernode: false                    # combine beacon+vc in single process
    count: 1                            # number of instances with this config
    validator_count: 64                 # validators assigned to this participant
```

## Network Parameters

```yaml
network_params:
  # Fork epochs (0 = from genesis, null = disabled)
  electra_fork_epoch: 0
  fulu_fork_epoch: 1

  # Timing
  seconds_per_slot: 12          # default 12, use 6 for faster devnets
  slots_per_epoch: 32           # default 32

  # Network
  network_id: "3151908"
  deposit_contract_address: "0x..."

  # Validator
  num_validator_keys_per_node: 64
  preregistered_validator_keys_mnemonic: "..."
```

## Additional Services

```yaml
additional_services:
  - dora              # chain explorer UI
  - assertoor         # automated testing
  - prometheus        # metrics collection
  - grafana           # metrics dashboards
  - blob_spammer      # blob transaction generator
  - el_forkmon        # fork monitor
  - beacon_metrics_gazer
  - blockscout        # block explorer with contract verification
```

## Assertoor Parameters

```yaml
assertoor_params:
  run_stability_check: true          # chain health, finality, reorgs
  run_block_proposal_check: true     # every client pair proposes a block
  run_transaction_test: false        # transaction lifecycle
  run_blob_transaction_test: false   # blob tx test
  run_opcodes_transaction_test: false
  tests: []                          # custom test configs
```

## Port Publisher

```yaml
port_publisher:
  el:
    enabled: true
    public_port_start: 32000    # EL HTTP/WS
  cl:
    enabled: true
    public_port_start: 33000    # CL beacon API
  vc:
    enabled: false
    public_port_start: 34000
```

Ports increment by 5 per service instance:
- cl-1: 33000, cl-2: 33005, cl-3: 33010, etc.
- el-1: 32000, el-2: 32005, el-3: 32010, etc.

## Global Settings

```yaml
global_log_level: info|debug|warn|error    # default: info
```

## Example Configs

### Minimal 2-Node Devnet

```yaml
participants:
  - el_type: geth
    cl_type: lodestar
    count: 1
    validator_count: 128
  - el_type: reth
    cl_type: lighthouse
    count: 1
    validator_count: 128

network_params:
  electra_fork_epoch: 0
  fulu_fork_epoch: 1
  seconds_per_slot: 6

additional_services:
  - dora
  - assertoor

assertoor_params:
  run_stability_check: true
  run_block_proposal_check: true
```

### Lodestar-Only with Custom Image

```yaml
participants:
  - el_type: reth
    cl_type: lodestar
    cl_image: lodestar:custom
    supernode: true
    count: 4
    validator_count: 64

network_params:
  electra_fork_epoch: 0
  fulu_fork_epoch: 0
  seconds_per_slot: 6

additional_services:
  - dora
  - prometheus
  - grafana

port_publisher:
  cl:
    enabled: true
    public_port_start: 33000
```

### Full Multi-Client Interop (6 clients)

```yaml
participants:
  - cl_type: lodestar
    el_type: reth
    count: 1
    validator_count: 64
  - cl_type: lighthouse
    el_type: geth
    count: 1
    validator_count: 64
  - cl_type: prysm
    el_type: geth
    count: 1
    validator_count: 64
  - cl_type: teku
    el_type: besu
    count: 1
    validator_count: 64
  - cl_type: nimbus
    el_type: nethermind
    count: 1
    validator_count: 64
  - cl_type: grandine
    el_type: reth
    count: 1
    validator_count: 64

network_params:
  electra_fork_epoch: 0
  fulu_fork_epoch: 1
  seconds_per_slot: 6

additional_services:
  - dora
  - assertoor
  - prometheus
  - grafana
  - el_forkmon

assertoor_params:
  run_stability_check: true
  run_block_proposal_check: true
```
