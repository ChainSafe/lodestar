# Execution Proofs

[EIP-8025](https://eips.ethereum.org/EIPS/eip-8025) adds optional execution proofs to the consensus layer. A proof-generating node proves inside a zkVM that an execution payload is valid and gossips the proof on the `execution_proof` topic, signed by an active validator. A proof-verifying node checks each proof against the public input it derives from the payload it already imported, keeps the first valid proof per block and proof type, and relays it. Payload validity still comes from the execution client, and stored proofs do not change fork choice.

Lodestar is a proof-verifying node as soon as it holds at least one verification key. It then advertises `eproof` in its ENR, subscribes to the topic, accepts proofs on `POST /eth/v1/beacon/execution_proofs`, and exposes proof engine metrics with the verification time and result per proof type.

## Requirements

- A `@chainsafe/lodestar-z` build with the `ere` verifier. The published Linux packages include it. The macOS package does not, and a node configured with verification keys refuses to start there with `EXECUTION_PROOF_VERIFIER_UNAVAILABLE`.
- A verifier built against the same `ere` release as the provers. A proof made with a newer SP1 or ZisK than the verifier knows fails verification even when it is valid, so check the `ere` version in the lodestar-z release notes against the provers you expect to see.
- One raw verification key file per proof type you want to verify, taken from the [`eth-act/ere-guests`](https://github.com/eth-act/ere-guests/releases) release the provers run. Each release ships a `minisign.pub` and a `.minisig` per file to check the download.

## Proof types

A proof type names one immutable combination of guest program, zkVM and version. The EIP-8025 spec assigns these, together with the SHA-256 digest of each verification key:

| Proof type | Guest program | zkVM   |
| ---------- | ------------- | ------ |
| 1          | ethrex        | OpenVM |
| 2          | ethrex        | SP1    |
| 3          | ethrex        | ZisK   |
| 4          | reth          | OpenVM |
| 5          | reth          | SP1    |
| 6          | reth          | ZisK   |
| 7          | zesu          | ZisK   |

The assignments are provisional, so the key generation they pin matters. The spec digests are the `ere-guests` v0.17.0 keys, which is what the provers active on Sepolia in late October 2026 run: `eth-act/lighthouse` with the ERE v0.17.2 verifier and `zkboost` 0.12.0, proving with OpenVM on proof types 1 and 4. `zkboost` v0.19.1 moves to the `ere-guests` v0.19.0 keys and adds proof types 8 to 12; none of those keys match the spec digests:

| Proof type | Key file in `ere-guests` v0.19.0                      |
| ---------- | ----------------------------------------------------- |
| 1          | `stateless-validator-ethrex-openvm-v2.1.0-preview.vk` |
| 2          | `stateless-validator-ethrex-sp1-v6.9.0.vk`            |
| 3          | `stateless-validator-ethrex-zisk-v1.3.2-alpha.vk`     |
| 4          | `stateless-validator-reth-openvm-v2.1.0-preview.vk`   |
| 5          | `stateless-validator-reth-sp1-v6.9.0.vk`              |
| 6          | `stateless-validator-reth-zisk-v1.3.2-alpha.vk`       |
| 8          | `stateless-validator-nimbus-sp1-v6.9.0.vk`            |
| 9          | `stateless-validator-nimbus-zisk-v1.3.2-alpha.vk`     |
| 10         | `stateless-validator-nethermind-sp1-v6.9.0.vk`        |
| 11         | `stateless-validator-nethermind-zisk-v1.3.2-alpha.vk` |
| 12         | `stateless-validator-zilkworm-sp1-v6.9.0.vk`          |

## Configuring verifiers

`--chain.executionProofVerifiers` takes one entry per proof type in one of two forms:

- `<proofType>:<verificationKeyPath>` for a spec-assigned type. Lodestar takes the zkVM from the spec table and refuses to start if the SHA-256 of the file differs from the spec digest.
- `<proofType>:<zkvm>:<verificationKeyPath>` to assign the type explicitly, where `zkvm` is `openvm`, `sp1` or `zisk`. This skips the spec table and its digest check. Use it for a type the spec has not assigned yet, or for a key the spec digest does not match yet.

Every type you configure counts as supported on gossip. A proof for a type Lodestar does not know is rejected and penalizes the sending peer. A proof for a known type without a configured key is ignored without penalty, since Lodestar can neither confirm nor refute it.

### Sepolia

Register the spec keys for proof types 1 to 7 through the plain form, so Lodestar checks each file against the spec digest, and the newer generation's extra types explicitly. Download both key sets:

```bash
gh release download v0.17.0 --repo eth-act/ere-guests --pattern '*.vk' --dir keys/v0.17.0
```

```bash
gh release download v0.19.0 --repo eth-act/ere-guests --pattern '*.vk' --dir keys/v0.19.0
```

```bash
./lodestar beacon --network sepolia --checkpointSyncUrl <url> \
  --chain.executionProofVerifiers \
    1:keys/v0.17.0/stateless-validator-ethrex-openvm-v2.1.0-preview.vk \
    2:keys/v0.17.0/stateless-validator-ethrex-sp1-v6.4.0.vk \
    3:keys/v0.17.0/stateless-validator-ethrex-zisk-v1.1.0-alpha.vk \
    4:keys/v0.17.0/stateless-validator-reth-openvm-v2.1.0-preview.vk \
    5:keys/v0.17.0/stateless-validator-reth-sp1-v6.4.0.vk \
    6:keys/v0.17.0/stateless-validator-reth-zisk-v1.1.0-alpha.vk \
    7:keys/v0.17.0/stateless-validator-zesu-zisk-v1.1.0-alpha.vk \
    8:sp1:keys/v0.19.0/stateless-validator-nimbus-sp1-v6.9.0.vk \
    9:zisk:keys/v0.19.0/stateless-validator-nimbus-zisk-v1.3.2-alpha.vk \
    10:sp1:keys/v0.19.0/stateless-validator-nethermind-sp1-v6.9.0.vk \
    11:zisk:keys/v0.19.0/stateless-validator-nethermind-zisk-v1.3.2-alpha.vk \
    12:sp1:keys/v0.19.0/stateless-validator-zilkworm-sp1-v6.9.0.vk
```

Sepolia has run Gloas since epoch 353024, so the checkpoint must be at or after that epoch. A proof type holds one key at a time, so once the provers move to the v0.19.0 keys for types 1 to 6, switch those entries to the explicit form with the new files until the spec table follows. OpenVM proofs verify across `ere` releases because its version did not change; SP1 and ZisK proofs only verify with a verifier built for the same SP1 or ZisK version the prover used.

## Submitting proofs

Provers and relays submit a `SignedExecutionProofEnvelope` as SSZ to `POST /eth/v1/beacon/execution_proofs`. Lodestar validates it exactly like a gossip message, publishes it on success, and treats a proof it has already seen as a success without publishing it again. A rejected proof is reported with its index in the request and, with `--chain.persistInvalidSszObjects`, written to the data directory for inspection.
