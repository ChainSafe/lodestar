# EIP-8025 Devnet (Lodestar-first)

Kurtosis devnet to validate Lodestar EIP-8025 implementation end-to-end.

> Current state: Lodestar-only topology is fully runnable.
> Cross-client Lighthouse/Prysm interop in this script is pending availability of published optional-proofs images.

## Topology

- `cl-1-lodestar-reth`: normal node + validators (supernode)
- `cl-2-lodestar-geth`: normal node + validators (supernode)
- `cl-3-lodestar-reth`: zkvm node (`--activateZkvm`, no validators)
- `el-*`: matching EL clients (reth/geth)
- `dora`: optional dashboard

Dummy prover submits proofs to zkvm node via:

- `POST /eth/v1/beacon/pool/execution_proofs`

## Quick Start

```bash
# 1) Build Lodestar image from this branch
cd ~/lodestar-eip8025
docker build -t lodestar:eip8025 -f Dockerfile .

# 2) Start devnet
kurtosis run github.com/ethpandaops/ethereum-package \
  --enclave eip8025-devnet \
  --args-file scripts/eip8025-devnet/network_params.yaml

# 3) Start dummy prover against zkvm node
node scripts/dummy-prover.mjs \
  --beacon-node http://127.0.0.1:33015 \
  --proofs-per-block 1 \
  --proof-delay-ms 200
```

## Verify

```bash
# Proofs are being submitted
curl -s http://127.0.0.1:33015/eth/v1/beacon/pool/execution_proofs | jq '.data | length'

# Check execution proof handling logs
kurtosis service logs eip8025-devnet cl-3-lodestar-reth | grep -i "execution proof\|execution_proof"

# Check zkvm ENR
curl -s http://127.0.0.1:33015/eth/v1/node/identity | jq -r '.data.enr'
```

## Known caveats

- If no peers subscribe to `execution_proof` gossip topic, API submission still succeeds (proof is stored locally; gossip publish is best-effort).
- For mixed-client interop, update `network_params.yaml` to include Lighthouse/Prysm optional-proofs images when available.

## Cleanup

```bash
kurtosis enclave rm -f eip8025-devnet
```
