# EIP-8025 Mixed Client Devnet

Local kurtosis devnet for testing EIP-8025 optional execution proofs across clients.

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Kurtosis Devnet                                │
│                                                 │
│  ┌──────────────┐    ┌──────────────┐          │
│  │ Lodestar     │    │ Lighthouse   │          │
│  │ + reth (EL)  │◄──►│ + geth (EL)  │          │
│  │ validators   │    │ validators   │          │
│  └──────┬───────┘    └──────┬───────┘          │
│         │   gossip          │                   │
│  ┌──────▼───────┐    ┌──────▼───────┐          │
│  │ Lodestar     │    │ Lighthouse   │          │
│  │ --activateZkvm│   │ --activate-  │          │
│  │ + reth (EL)  │◄──►│   zkvm       │          │
│  │ no validators│    │ + reth (EL)  │          │
│  └──────────────┘    └──────────────┘          │
└─────────────────────────────────────────────────┘
         ▲                      ▲
         │  POST /pool/         │
         │  execution_proofs    │
    ┌────┴──────────────────────┴────┐
    │       Dummy Prover             │
    │  (subscribes to head events,   │
    │   submits fake proofs)         │
    └────────────────────────────────┘
```

## Prerequisites

- Docker
- [Kurtosis](https://docs.kurtosis.com/install/)
- Node.js 20+
- Lodestar Docker image built from this branch

## Quick Start

```bash
# 1. Build the Lodestar image from the EIP-8025 branch (Dockerfile.dev is faster)
cd ~/lodestar-eip8025
docker build -t lodestar:eip8025 -f Dockerfile.dev .

# 2. Start the devnet
./scripts/eip8025-devnet/start-devnet.sh

# 3. Find the Lodestar zkvm node's beacon API URL
kurtosis port print eip8025-devnet cl-3-lodestar-reth http

# 4. Start the dummy prover against it
node scripts/dummy-prover.mjs \
  --beacon-node http://127.0.0.1:<PORT> \
  --proofs-per-block 1 \
  --proof-delay-ms 500
```

## Verifying Interop

### Check proof gossip
```bash
# Lodestar logs — look for "Received execution proof via gossip"
kurtosis service logs eip8025-devnet cl-3-lodestar-reth 2>&1 | grep -i "execution.proof"

# Lighthouse logs — look for execution proof messages
kurtosis service logs eip8025-devnet cl-4-lighthouse-reth 2>&1 | grep -i "execution.proof"
```

### Query proof pool via API
```bash
# Get proofs from Lodestar
curl http://127.0.0.1:<PORT>/eth/v1/beacon/pool/execution_proofs

# Get proofs from Lighthouse
curl http://127.0.0.1:<PORT>/eth/v1/beacon/pool/execution_proofs
```

### Check ENR zkvm flag
```bash
# Lodestar node identity
curl http://127.0.0.1:<PORT>/eth/v1/node/identity | jq '.data.enr'
# Should contain zkvm=1 in the ENR
```

## Configuration

### network_params.yaml

Key settings:
- `fulu_fork_epoch: 1` — Fulu activates at epoch 1 (zkvm only available post-Fulu)
- `seconds_per_slot: 6` — Faster than mainnet for quicker testing
- `--activateZkvm` / `--activate-zkvm` — Enables zkvm mode per client
- `--chain.minProofsRequired=1` — Only require 1 proof type for availability (Lodestar)

### dummy-prover.mjs

| Option | Default | Description |
|--------|---------|-------------|
| `--beacon-node` | `http://localhost:5052` | Beacon node HTTP endpoint |
| `--proofs-per-block` | `1` | Number of proof IDs (0..N-1) per block |
| `--proof-delay-ms` | `1000` | Simulated proof generation time |
| `--backfill-slots` | `0` | Backfill proofs for N recent slots on startup |

## Cleanup

```bash
kurtosis enclave stop eip8025-devnet
kurtosis enclave rm eip8025-devnet
```
