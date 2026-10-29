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

## Running a Sepolia proof-verifying node

This walkthrough was last run on 2026-10-30 against the Sepolia provers described above. It assumes a Linux host with a public address, since provers are usually outbound-only and dial you, plus Node.js 22 or newer, `pnpm`, `git` and `curl`. Pick a working directory and keep both checkouts in it:

```bash
export WORK=$PWD L=$PWD/lodestar-8025 Z=$PWD/lodestar-z-ere
```

### 1. Build Lodestar

Until the EIP-8025 branch is merged and released, build it from source:

```bash
git clone --branch bing/eip-8025 --depth 1 https://github.com/ChainSafe/lodestar.git "$L"
cd "$L" && pnpm install --frozen-lockfile && pnpm build
```

### 2. Use a verifier built for the provers' `ere` release

The published `@chainsafe/lodestar-z` 2.2.0 carries the ERE v0.19.2 verifier. Until a release with ERE v0.19.6 is out, build the bindings from the `bing/ere-0.19.6` branch with Zig 0.16.0 and point the whole monorepo at them. Skip this step once `pnpm install` brings a lodestar-z release that lists ERE v0.19.6 or newer.

```bash
cd "$WORK"
curl -sSL -o zig.tar.xz https://ziglang.org/download/0.16.0/zig-x86_64-linux-0.16.0.tar.xz
echo "70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00  zig.tar.xz" | sha256sum -c -
tar -xJf zig.tar.xz && rm zig.tar.xz
export PATH="$WORK/zig-x86_64-linux-0.16.0:$PATH"
```

```bash
git clone --branch bing/ere-0.19.6 --depth 1 https://github.com/ChainSafe/lodestar-z.git "$Z"
cd "$Z" && zig build build-lib:bindings -Doptimize=ReleaseSafe && pnpm install --frozen-lockfile --ignore-scripts
```

Replace the single pnpm store entry, not one package's link. The BLS worker threads load lodestar-z as well, and two copies of the native module split the pubkey cache, after which every block batch fails with `PubkeyIndexNotFound`:

```bash
cd "$L/node_modules/.pnpm/@chainsafe+lodestar-z@2.2.0/node_modules/@chainsafe"
mv lodestar-z lodestar-z.orig && ln -s "$Z" lodestar-z
cd "$L" && node -e 'import("@chainsafe/lodestar-z/execution-proof-verifier").then((m) => console.log("verifier available:", m.EXECUTION_PROOF_VERIFIER_AVAILABLE))'
```

### 3. Download the verification keys

Spec keys for proof types 1 to 7 come from the `ere-guests` v0.17.0 release, the extra types from v0.19.0:

```bash
mkdir -p "$WORK/keys/v0.17.0" "$WORK/keys/v0.19.0"
for f in ethrex-openvm-v2.1.0-preview ethrex-sp1-v6.4.0 ethrex-zisk-v1.1.0-alpha reth-openvm-v2.1.0-preview reth-sp1-v6.4.0 reth-zisk-v1.1.0-alpha zesu-zisk-v1.1.0-alpha; do
  curl -sSL -o "$WORK/keys/v0.17.0/stateless-validator-$f.vk" "https://github.com/eth-act/ere-guests/releases/download/v0.17.0/stateless-validator-$f.vk"
done
for f in nimbus-sp1-v6.9.0 nimbus-zisk-v1.3.2-alpha nethermind-sp1-v6.9.0 nethermind-zisk-v1.3.2-alpha zilkworm-sp1-v6.9.0; do
  curl -sSL -o "$WORK/keys/v0.19.0/stateless-validator-$f.vk" "https://github.com/eth-act/ere-guests/releases/download/v0.19.0/stateless-validator-$f.vk"
done
```

A spec-form key whose SHA-256 differs from the table stops the node at startup with `EXECUTION_PROOF_VERIFICATION_KEY_MISMATCH`, so a wrong download shows up immediately.

### 4. Start the node

Point `--execution.urls` and `--jwtSecret` at a Sepolia execution client as usual. The command below uses `--execution.engineMock` instead, which runs a verify-and-relay node that imports payloads without validating them, enough to verify and forward proofs but not a node to trust for chain validity. Sepolia has run Gloas since epoch 353024, so any checkpoint provider must serve a state at or after that epoch.

```bash
cd "$L" && K=$WORK/keys
nohup ./lodestar beacon --network sepolia --dataDir "$WORK/sepolia-data" \
  --execution.engineMock --checkpointSyncUrl https://beaconstate-sepolia.chainsafe.io \
  --port 9030 --rest.port 9599 --metrics --metrics.port 8038 \
  --chain.executionProofVerifiers \
    1:$K/v0.17.0/stateless-validator-ethrex-openvm-v2.1.0-preview.vk \
    2:$K/v0.17.0/stateless-validator-ethrex-sp1-v6.4.0.vk \
    3:$K/v0.17.0/stateless-validator-ethrex-zisk-v1.1.0-alpha.vk \
    4:$K/v0.17.0/stateless-validator-reth-openvm-v2.1.0-preview.vk \
    5:$K/v0.17.0/stateless-validator-reth-sp1-v6.4.0.vk \
    6:$K/v0.17.0/stateless-validator-reth-zisk-v1.1.0-alpha.vk \
    7:$K/v0.17.0/stateless-validator-zesu-zisk-v1.1.0-alpha.vk \
    8:sp1:$K/v0.19.0/stateless-validator-nimbus-sp1-v6.9.0.vk \
    9:zisk:$K/v0.19.0/stateless-validator-nimbus-zisk-v1.3.2-alpha.vk \
    10:sp1:$K/v0.19.0/stateless-validator-nethermind-sp1-v6.9.0.vk \
    11:zisk:$K/v0.19.0/stateless-validator-nethermind-zisk-v1.3.2-alpha.vk \
    12:sp1:$K/v0.19.0/stateless-validator-zilkworm-sp1-v6.9.0.vk \
  > "$WORK/sepolia-data.log" 2>&1 &
```

A proof type holds one key at a time. Once the provers move to the v0.19.0 keys for types 1 to 6, switch those entries to the explicit form with the new files until the spec table follows. OpenVM proofs verify across `ere` releases because its version did not change; SP1 and ZisK proofs only verify with a verifier built for the same SP1 or ZisK version the prover used.

### 5. Check that it works

```bash
curl -s http://127.0.0.1:9599/eth/v1/node/syncing
curl -s http://127.0.0.1:8038/metrics | grep -E 'gossipsub_topic_peer_count.*execution_proof|execution_proof_engine_verify_result_total'
curl -s http://127.0.0.1:9599/eth/v1/node/identity | jq -r '.data.enr'
```

The node should report `is_syncing: false` within a few minutes of checkpoint sync. The topic peer count shows how many connected peers subscribe to `execution_proof`; expect a handful at most today. The verify counter grows by one per proof that reached the engine, labelled with the result. The ENR carries `eproof`, which other proof-aware nodes prefer in discovery.

### 6. Get proofs flowing

Provers such as the OpenVM one described above are outbound-only, so they have to dial you. Open the p2p port inbound for TCP and UDP and the next port up for UDP, which QUIC uses, then give the prover operators your ENR or peer id so they add you as a trusted peer. A node that only connects outbound still relays proofs it happens to receive from a proof-aware peer, but it waits on luck.

### Troubleshooting

- Discovery finds no peers behind a VPN or a high-latency link: discv5 gives up on a request after one second and the bootnodes drop out of the table. Start with `--rest.namespace '*'` and feed peers through `POST /eth/v1/lodestar/connect_peer?peerId=<id>&multiaddr=/ip4/<ip>/tcp/<port>`.
- Every block batch fails with `PubkeyIndexNotFound`: the binding was linked for a single package. Redo the store swap in step 2.
- `EXECUTION_PROOF_VERIFIER_UNAVAILABLE` at startup: the installed lodestar-z has no `ere` verifier for this platform. The published macOS package is one such case; build the bindings as in step 2.
- `EXECUTION_PROOF_VERIFICATION_KEY_MISMATCH`: the file for that proof type belongs to another key generation. Use the explicit form if the provers you follow are on newer keys than the spec table.

## Submitting proofs

Provers and relays submit a `SignedExecutionProofEnvelope` as SSZ to `POST /eth/v1/beacon/execution_proofs`. Lodestar validates it exactly like a gossip message, publishes it on success, and treats a proof it has already seen as a success without publishing it again. A rejected proof is reported with its index in the request and, with `--chain.persistInvalidSszObjects`, written to the data directory for inspection.
