---
name: kurtosis-devnet
description: Run Ethereum multi-client devnets using Kurtosis and the ethpandaops/ethereum-package. Use for spinning up local testnets, validating cross-client interop, testing fork transitions, running assertoor checks, debugging CL/EL client interactions, or verifying new feature implementations across multiple consensus and execution clients.
---

# Kurtosis Devnet

Run Ethereum consensus/execution client devnets via [Kurtosis](https://github.com/kurtosis-tech/kurtosis) + [ethereum-package](https://github.com/ethpandaops/ethereum-package).

## Prerequisites

- [Kurtosis CLI](https://docs.kurtosis.com/install/) installed
- Docker running with sufficient resources (8GB+ RAM recommended for multi-client devnets)

## Quick Start

```bash
# Start devnet from config
# Always use --image-download always to ensure external images are up to date
kurtosis run github.com/ethpandaops/ethereum-package \
  --enclave <name> \
  --args-file network_params.yaml \
  --image-download always

# List enclaves
kurtosis enclave ls

# Inspect services
kurtosis enclave inspect <name>

# View logs
kurtosis service logs <enclave> <service-name>
kurtosis service logs <enclave> <service-name> --follow

# Cleanup
kurtosis enclave rm -f <name>
# Or clean all enclaves
kurtosis clean -a
```

## Config File (`network_params.yaml`)

See `references/config-reference.md` for the full config structure.

Key sections:
- `participants`: list of CL+EL client pairs with images, flags, validator counts
- `network_params`: fork epochs, slot time, network-level settings
- `additional_services`: dora (explorer), assertoor (testing), prometheus, grafana
- `assertoor_params`: automated chain health checks
- `port_publisher`: expose CL/EL ports to host

## Building Custom Client Images

When testing local Lodestar branches, build a Docker image first:

```bash
# Fast build (recommended for iteration)
cd ~/lodestar && docker build -t lodestar:custom -f Dockerfile.dev .

# Production build (slower, for final validation only)
cd ~/lodestar && docker build -t lodestar:custom .

# Then reference in config:
# cl_image: lodestar:custom
```

**Always use `Dockerfile.dev` for iterative development.** It caches dependency layers and rebuilds in seconds vs minutes for the production Dockerfile. Only use the production `Dockerfile` for final validation or debugging build issues.

## Service Naming Convention

Kurtosis names services as: `{role}-{index}-{cl_type}-{el_type}`

Examples:
- `cl-1-lodestar-reth` — first CL node (Lodestar with Reth EL)
- `el-1-reth-lodestar` — corresponding EL node
- `vc-1-lodestar-reth` — validator client

## Accessing Services

After `kurtosis enclave inspect <name>`, find mapped ports:

```bash
# CL beacon API (find actual port from inspect output)
curl http://127.0.0.1:<mapped-port>/eth/v1/node/syncing

# Or use port_publisher for predictable ports:
# port_publisher:
#   cl:
#     enabled: true
#     public_port_start: 33000  # cl-1=33000, cl-2=33005, etc.
#   el:
#     enabled: true
#     public_port_start: 32000
```

Port publisher assigns sequential ports (step of 5 per service).

## Assertoor (Automated Testing)

Add to config:
```yaml
additional_services:
  - assertoor

assertoor_params:
  run_stability_check: true        # chain stability, finality, no reorgs
  run_block_proposal_check: true   # every client pair proposes a block
```

Check results via the assertoor web UI (port shown in `kurtosis enclave inspect`).

## Common Devnet Patterns

### Fork Transition Testing
```yaml
network_params:
  electra_fork_epoch: 0
  fulu_fork_epoch: 1      # fork at epoch 1 (slot 32)
  seconds_per_slot: 6      # faster for testing
```

### Mixed-Client Topology (Cross-Client Interop)
```yaml
participants:
  - cl_type: lodestar
    el_type: reth
    count: 2
    validator_count: 128
  - cl_type: lighthouse
    el_type: geth
    count: 2
    validator_count: 128
```

### Observer Nodes (No Validators)
```yaml
- cl_type: lodestar
  cl_image: lodestar:custom
  el_type: reth
  count: 1
  validator_count: 0       # observer-only
```

### Supernode Mode
Set `supernode: true` to run beacon+validator in a single process (faster startup, simpler topology):
```yaml
- cl_type: lodestar
  el_type: reth
  supernode: true
  validator_count: 128
```

### Extra CL/VC Params
```yaml
cl_extra_params:
  - --targetPeers=8
  - --logLevel=debug
vc_extra_params:
  - --suggestedFeeRecipient=0x...
```

## Monitoring & Debugging

```bash
# Stream logs from a specific service
kurtosis service logs <enclave> cl-1-lodestar-reth --follow

# Save all CL logs for analysis
for svc in $(kurtosis enclave inspect <enclave> 2>/dev/null | grep -oP 'cl-\d+-\S+'); do
  kurtosis service logs <enclave> $svc > "/tmp/${svc}.log" 2>&1
done

# Dora explorer (if enabled) — find port via inspect output

# Check chain finality
curl -s http://127.0.0.1:<port>/eth/v1/beacon/states/head/finality_checkpoints | jq

# Check peer count
curl -s http://127.0.0.1:<port>/eth/v1/node/peers | jq '.data | length'

# Check sync status
curl -s http://127.0.0.1:<port>/eth/v1/node/syncing | jq
```

### Wait for Finality

Finality typically takes 2-3 epochs after genesis. With `seconds_per_slot: 6` and 32 slots/epoch:
- 1 epoch ≈ 192s (3.2 min)
- First finalization ≈ epoch 3-4 boundary (≈10-13 min)

Monitor:
```bash
curl -s http://<port>/eth/v1/beacon/states/head/finality_checkpoints | jq '.data.finalized.epoch'
```

### Acceptance Criteria Pattern

For interop validation, define acceptance criteria **before** running the soak test:

```bash
# Example: check for zero errors across all CL nodes
for svc in cl-1-lodestar-reth cl-2-lodestar-reth; do
  echo "=== $svc ==="
  kurtosis service logs <enclave> $svc 2>&1 | grep -c "ERROR" || echo "0 errors"
done
```

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Peers not connecting | Increase `--targetPeers`, check `directPeers` config |
| No finality | Need ≥2/3 validators attesting; check VC logs |
| "discv5 has no boot enr" | Harmless startup warning, ignore |
| Port conflicts | Change `public_port_start` or stop conflicting enclaves |
| Image not found | Ensure Docker image is built locally or available in registry |
| Slow startup | Use `Dockerfile.dev` for local builds; reduce validator count |
| Docker bind error | Use non-default port ranges; `kurtosis clean -a` between runs |
| Stale enclave state | Always `kurtosis clean -a` before relaunching (not `docker system prune`) |

## Tips

- **Start small:** 2+2 nodes for iteration, scale up for final validation
- **Test both roles:** Validator nodes show different bugs than observers — always check both
- **Multiple soak passes:** First clean run may miss edge cases. Run extended soaks (hours).
- **`kurtosis clean -a`** between runs — never use `docker system prune` (it can remove Kurtosis engine images)
- **Debug logs:** Set `global_log_level: "debug"` for verbose output from all nodes
- **Per-participant log levels:** Use `cl_log_level` / `el_log_level` on individual entries for targeted debugging
