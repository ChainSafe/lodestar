# Lodestar HA Validator: Product Requirements (Draft 0.1)

Status: draft for discussion, 2026-09-24. This is a minimal product requirements document (PRD) for a high-availability (HA) validator offering built in `packages/high-availability`, aggregated from the [Lodestar baseline](./lodestar-ha-baseline.md), the [Vouch](./vouch-feature-analysis.md), [Dirk](./dirk-feature-analysis.md) and [Vero](./vero-feature-analysis.md) analyses, the [first-principles architectures](./ha-first-principles-and-architectures.md) and the [post-quantum options](./post-quantum-signing-options.md). Requirements cite Lodestar gaps as `L1`..`L16`, architectures as `A1`..`A6`, and competitor precedents by name. Priorities: P0 must ship in the first release that claims HA, P1 in the following release, P2 later.

## 1. Vision

A validator product that lets any Ethereum operator, from a solo staker to a multi-region institution, run redundant validator clients, redundant beacon nodes and redundant signers with zero slashing risk and zero-miss maintenance, on one open-source substrate that already works for post-quantum keys.

## 2. Problem

The Lodestar validator client is a single-instance design: cold beacon node fallback that waits a full timeout (`L1`), an event stream pinned to one node (`L2`), no fan-out or cross-checking (`L3`, `L4`), one remote signer URL per key with no failover, timeout or authentication (`L6`), a local single-process slashing database (`L8`), and no coordination between instances (`L9`). Operators who want HA today choose between Vouch plus Dirk (Go, threshold BLS, no slashing database or doppelganger detection in the client, passive takeover with a four-second timing cost) and Vero (Python, best-in-class beacon node agreement, but validator-layer redundancy only as a closed-source sponsor feature and a signer layer that is a single point of failure). Neither is post-quantum ready, and neither offers an open, replicated safety record.

## 3. Goals and non-goals

Goals:

1. Zero slashable or key-compromising signatures under any combination of component failures, partitions, restarts and operator errors the product is designed for.
2. Survive any single component failure without human action, and any planned maintenance with zero missed duties.
3. Attestation, proposal and sync committee effectiveness at least equal to a well-run single Lodestar VC, and better in the presence of node failures or client bugs.
4. One product for `A1` through `A5`, with `A6` as a mode.
5. Post-quantum ready: the safety record and signer interface work unchanged for leanXMSS keys.
6. Open source, no sponsor-only tiers for safety features.

Non-goals for the first two releases:

- Building a new threshold signing scheme or a distributed key generation ceremony (Dirk and DVT middleware remain the BLS threshold options).
- Replacing MEV-Boost with an embedded relay service as Vouch does.
- A hosted or managed service.

## 4. Users and scenarios

| User                          | Validators      | Scenario                                                                            | Architecture             |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------- | ------------------------ |
| Solo or small staker          | 1 to 100s       | Protection from client bugs and node failures on one VC host                        | A1                       |
| Professional operator         | 100s to 10 000s | Zero-miss upgrades, VC host loss tolerance, remote signer                           | A2 or A3                 |
| Custody-focused operator      | any             | Threshold BLS keys via Dirk, multiple VCs                                           | A4 backend with A2 or A3 |
| Institution                   | 10 000s+        | Multi-region, hardware custody, compliance                                          | A5                       |
| DVT operator                  | any             | Robust node behind Obol or SSV middleware                                           | A6                       |
| Any of the above, 2027 onward | any             | Registered PQ keys with leaf-state protection before and after the signature switch | all                      |

## 5. Competitive positioning

| Capability                                      | Lodestar HA (target)       | Vero OSS              | Vero + sponsor               | Vouch + Dirk                             |
| ----------------------------------------------- | -------------------------- | --------------------- | ---------------------------- | ---------------------------------------- |
| Active-active beacon layer with fan-out publish | Yes                        | Yes                   | Yes                          | Yes, per-operation strategies            |
| Attestation data agreement threshold            | Yes                        | Yes                   | Yes                          | Yes, majority styles                     |
| Multiple VC instances, same keys                | Yes, lease or quorum, open | No                    | Yes, closed (Devo, Failover) | Yes, passive inference plus Dirk denials |
| Replicated safety record                        | Yes, open ledger           | No                    | Closed (Devo)                | No, per-Dirk state plus threshold        |
| Signer failover or multiple signer URLs per key | Yes                        | No                    | No                           | n/a, threshold                           |
| Threshold BLS                                   | Via Dirk backend           | Via unaudited sidecar | Via sidecar                  | Native                                   |
| Local keys with protection                      | Yes                        | No                    | No                           | Unprotected wallets                      |
| Doppelganger detection                          | Yes, ledger-aware          | Yes                   | Yes                          | No                                       |
| Slashing event detection and halt               | Yes                        | Yes                   | Yes                          | No                                       |
| Health and readiness endpoint                   | Yes                        | No                    | Primary only                 | No                                       |
| Keymanager API                                  | Yes, full                  | Remote keys only      | Same                         | No                                       |
| Post-quantum leaf-state protection              | Yes                        | No                    | No                           | No                                       |
| Gloas support                                   | Yes                        | No                    | No                           | No                                       |

The product out-competes on four points no competitor has published: an open replicated safety ledger that makes multi-instance safe for any signer type; signer redundancy for the same key; a substrate that carries over to post-quantum keys; and the combination of Vero's beacon-layer agreement with Vouch's per-operation flexibility in one client that already supports the newest forks.

## 6. Product shape

Three components, one cluster definition:

1. **HA validator client.** The Lodestar duty services rebuilt on an active-active beacon layer, holding no safety state, obtaining signatures only through the ledger gate.
2. **Safety ledger.** A strictly consistent, replicated record of every signature decision per key (EIP-3076 rules for BLS, leaf high-water marks for PQ), plus leases. Embedded single-replica mode for `A1`; three or more replicas for `A2` and above.
3. **Signer interface.** Fencing-token-gated, idempotent signing with backends for local keystores, the Ethereum Remote Signing API, Dirk, and EIP-8310 post-quantum seeds.

A single declarative cluster definition (members, node sets, ledger, signer backends, key sets) is distributed to every member so that instances cannot drift.

## 7. Requirements

### 7.1 Beacon node layer (R-BN)

| ID      | Requirement                                                                                                                                                                                                                   | Priority | Source                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| R-BN-1  | Every configured beacon node is used concurrently; no primary-only mode                                                                                                                                                       | P0       | L1, Vero, Vouch                           |
| R-BN-2  | Publishes fan out to all nodes and succeed on first acceptance; remaining publishes continue in the background                                                                                                                | P0       | L3, Vouch submitter, Vero                 |
| R-BN-3  | Client-specific "already known" errors count as publish success                                                                                                                                                               | P1       | Vouch                                     |
| R-BN-4  | Attestation data agreement above a configurable threshold, default strict majority, with checkpoint caching per epoch, head-root fast path on head events, and full-struct fallback; fail closed for the slot on no agreement | P0       | L4, Vero, Vouch combinedmajority          |
| R-BN-5  | Block production on all nodes in a proposal set, best by consensus plus execution value, with a Gnosis consensus-only rule                                                                                                    | P0       | Vero, Vouch best                          |
| R-BN-6  | Aggregates and sync contributions best-of-N by participation                                                                                                                                                                  | P1       | Vero, Vouch                               |
| R-BN-7  | Sync committee head root by majority or latest across nodes                                                                                                                                                                   | P1       | Vouch beaconblockroot                     |
| R-BN-8  | Event stream subscribed on every node with de-duplication and per-node reconnect                                                                                                                                              | P0       | L2, Vero                                  |
| R-BN-9  | Per-node health from sync status, optimistic flag, head timing and request outcomes; degraded nodes demoted for single-node picks and evicted from fan-out after sustained failure, re-admitted on recovery                   | P0       | L5, Vouch multi, Vero scoring             |
| R-BN-10 | Per-operation node sets and optional proposal-only nodes                                                                                                                                                                      | P1       | L13, Vouch strategies, Vero proposal URLs |
| R-BN-11 | Per-node timeouts, per-operation timeouts, bearer or basic auth, and mTLS                                                                                                                                                     | P1       | L14, Vouch hierarchical config            |
| R-BN-12 | Reject execution-optimistic responses for attestation and duty data                                                                                                                                                           | P0       | Vero                                      |
| R-BN-13 | Per-node spec check at startup, overridable                                                                                                                                                                                   | P1       | Vero                                      |
| R-BN-14 | Warn or refuse when one client implementation holds a majority of the agreement set                                                                                                                                           | P1       | first principles 4.5                      |

### 7.2 Safety ledger (R-LEDGER)

| ID          | Requirement                                                                                                                                                                                                                                             | Priority | Source                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- |
| R-LEDGER-1  | Strictly consistent replicated store of per-key EIP-3076 state (block slots, attestation source and target with surround protection) with quorum writes; no eventual consistency                                                                        | P0       | L8, A2, Devo                 |
| R-LEDGER-2  | Reservation API: `reserve(key, slot or target epoch, message hash, fencing token)` durably committed before any signature is released; second reservation with a different hash for the same slot is refused; identical hash returns the prior decision | P0       | PQ options 6.1-6.4, EIP-8310 |
| R-LEDGER-3  | Lease API for active-passive operation: acquire, renew, release, forced handover; fencing token issued with the lease and checked on every reservation                                                                                                  | P0       | A2                           |
| R-LEDGER-4  | Embedded single-replica mode for single-member clusters, upgradeable to replicated without data migration                                                                                                                                               | P0       | A1                           |
| R-LEDGER-5  | A minority of replicas may be lost with no effect; loss of quorum stops signing with no override                                                                                                                                                        | P0       | first principles 4.3         |
| R-LEDGER-6  | High-water mark regression detection on import or replica rejoin; affected keys refuse to sign until reconciled                                                                                                                                         | P0       | EIP-8310                     |
| R-LEDGER-7  | EIP-3076 v5 import and export, CLI and keymanager API, including for keys that were never local                                                                                                                                                         | P0       | Lodestar, Dirk gap           |
| R-LEDGER-8  | Signature cache keyed by key, slot and message hash for idempotent signing                                                                                                                                                                              | P1       | PQ options Option C          |
| R-LEDGER-9  | PQ leaf high-water marks for attester and proposer keys, and reserved leaf ranges for counter-mode keys                                                                                                                                                 | P1       | PQ options 6.1, 6.6          |
| R-LEDGER-10 | Reservation round trip under 100 ms within a region on commodity hardware; measured and exported                                                                                                                                                        | P0       | first principles 4.4         |
| R-LEDGER-11 | Backup, restore, membership change and replica replacement procedures, tested                                                                                                                                                                           | P1       | Dirk gap                     |

### 7.3 Signer layer (R-SIG)

| ID      | Requirement                                                                                                                         | Priority                                 | Source          |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------- |
| R-SIG-1 | Signing requests carry the full message and a fencing token; the signer verifies the token and consults the ledger before signing   | P0                                       | A2, A3          |
| R-SIG-2 | Backends: local EIP-2335 keystores, Ethereum Remote Signing API, Dirk (composite threshold signatures)                              | P0 for local and remote API, P1 for Dirk | Lodestar, Vouch |
| R-SIG-3 | Multiple remote signer URLs per key with health-based routing and failover                                                          | P0                                       | L6              |
| R-SIG-4 | Per-request timeouts, retries within the duty deadline, priority pools for slot-critical types, and fast-then-slow publishing       | P0                                       | L6, Vero        |
| R-SIG-5 | mTLS and bearer authentication to remote signers                                                                                    | P1                                       | L6, Dirk        |
| R-SIG-6 | Batch signing where the backend supports it, split per account as Dirk requires                                                     | P1                                       | Vouch           |
| R-SIG-7 | Signer health polled and used for routing, not only metrics                                                                         | P0                                       | Vero gap        |
| R-SIG-8 | Structured requests preserved end to end so signer-side rules can run                                                               | P0                                       | Vouch, Dirk     |
| R-SIG-9 | Optional Lodestar signer daemon exposing the Remote Signing API with the ledger embedded, for operators who want a supported signer | P2                                       | open decision   |

### 7.4 Cluster and coordination (R-CLUSTER)

| ID          | Requirement                                                                                                                                 | Priority | Source               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- |
| R-CLUSTER-1 | Named cluster with a single declarative definition distributed to members; members refuse to start on definition mismatch                   | P0       | first principles 8.1 |
| R-CLUSTER-2 | Active-passive mode: one lease per key set, configurable lease length, default about one slot, heartbeat at a quarter slot                  | P0       | A2                   |
| R-CLUSTER-3 | Active-active mode: all members compute and request; the ledger admits one message per key and slot; identical duplicates served from cache | P1       | A3                   |
| R-CLUSTER-4 | Planned handover and drain commands that complete the current slot's duties and move the lease with zero missed duties                      | P0       | first principles 4.9 |
| R-CLUSTER-5 | Refuse to start a second member for a key set without a replicated ledger unless explicitly acknowledged                                    | P0       | guardrails           |
| R-CLUSTER-6 | Key sets assignable to members or regions, with per-key-set leases                                                                          | P2       | A5                   |
| R-CLUSTER-7 | Distributed mode for DVT middleware retained and extended                                                                                   | P1       | A6, Lodestar         |
| R-CLUSTER-8 | Passive inference fallback (attestation pool and block header checks) available when no ledger is configured, clearly labelled degraded     | P2       | Vouch static-delay   |

### 7.5 Safety mechanisms (R-SAFE)

| ID       | Requirement                                                                                                                                                                  | Priority | Source                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------ |
| R-SAFE-1 | Doppelganger detection using every node, on by default for keys the ledger has not seen recently, skipped for keys with recent ledger activity                               | P0       | L10, Vero, Lodestar            |
| R-SAFE-2 | Slashing event detection from `attester_slashing` and `proposer_slashing` events and validator status; halt all slashable duties for all keys until operator acknowledgement | P0       | L11, Vero                      |
| R-SAFE-3 | Sign-time sanity checks retained (future slot, future target, duty and data consistency)                                                                                     | P0       | Lodestar                       |
| R-SAFE-4 | Duty-aware graceful shutdown that completes imminent proposals and current duties                                                                                            | P0       | Vero                           |
| R-SAFE-5 | Clock skew check against beacon node time; refuse to act above a bound                                                                                                       | P1       | first principles failure model |
| R-SAFE-6 | Sync-lag gate: never sign for slots older than a configured bound                                                                                                            | P1       | PQ options 6.12                |
| R-SAFE-7 | Deterministic signing pinned across members; refuse mixed implementations                                                                                                    | P1       | PQ options 6.9                 |

### 7.6 Duty scheduling (R-DUTY)

| ID       | Requirement                                                                                                 | Priority | Source          |
| -------- | ----------------------------------------------------------------------------------------------------------- | -------- | --------------- |
| R-DUTY-1 | Fast-track attestations and sync messages on head events with a configurable grace, fixed deadline fallback | P0       | Lodestar, Vouch |
| R-DUTY-2 | Duty cache persisted across restarts so a rejoining member acts in its first slot                           | P1       | Vero            |
| R-DUTY-3 | RANDAO reveal, selection proofs and registrations prepared off the critical path                            | P1       | Vero, Vouch     |
| R-DUTY-4 | Dependent-root reorg handling for attestations, proposals, PTC and sync committee duties                    | P0       | L16             |
| R-DUTY-5 | Bounded duty refresh retries that never cross an epoch boundary, re-evaluating the best node each attempt   | P1       | Vero            |
| R-DUTY-6 | Full fork support through Gloas including PTC and in-protocol builders, preserved from Lodestar             | P0       | Lodestar        |

### 7.7 Block production and MEV (R-MEV)

| ID      | Requirement                                                                                                 | Priority | Source      |
| ------- | ----------------------------------------------------------------------------------------------------------- | -------- | ----------- |
| R-MEV-1 | Builder selection strategies, boost factor, per-key builder configuration and Gloas builder flows preserved | P0       | Lodestar    |
| R-MEV-2 | Registrations sent to one node per cluster to avoid duplicates, re-sent before each proposal                | P1       | Vero        |
| R-MEV-3 | Proposal-only node sets wired to MEV infrastructure                                                         | P1       | Vero, Vouch |
| R-MEV-4 | Per-node block value metrics                                                                                | P1       | Vero        |

### 7.8 Key and validator management (R-KEY)

| ID      | Requirement                                                                                                      | Priority | Source               |
| ------- | ---------------------------------------------------------------------------------------------------------------- | -------- | -------------------- |
| R-KEY-1 | Full keymanager API retained, extended with cluster-aware import that routes protection data to the ledger       | P0       | Lodestar             |
| R-KEY-2 | Import of a key with fresh state triggers doppelganger detection; import of a PQ key with fresh state is refused | P0       | guardrails, EIP-8310 |
| R-KEY-3 | Per-key settings replicated via the cluster definition or ledger so all members agree                            | P0       | first principles 8.1 |
| R-KEY-4 | Dynamic graffiti provider and secrets from files, environment, or secret managers                                | P2       | Vouch                |
| R-KEY-5 | EIP-8310 keystore v5 import and export with Recover versus Resume semantics                                      | P1       | PQ options 6.14      |

### 7.9 Observability (R-OBS)

| ID      | Requirement                                                                                                          | Priority | Source               |
| ------- | -------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- |
| R-OBS-1 | Health and readiness endpoint per member answering ledger health, role, node health and last-epoch duty outcome      | P0       | L12                  |
| R-OBS-2 | Per-node metrics: score, version, head timing, agreement contributions, request rates and latency, block values      | P0       | Vero, Vouch          |
| R-OBS-3 | Per-operation "which node won" metrics                                                                               | P1       | Vouch strategies     |
| R-OBS-4 | Ledger metrics: quorum health, reservation latency, refusals with reason, lease changes, high-water mark regressions | P0       | first principles 8.4 |
| R-OBS-5 | Signer metrics: per-backend health, latency by request type, errors, denials                                         | P0       | Vero, Dirk           |
| R-OBS-6 | Shipped Grafana dashboards for A1 and A2/A3                                                                          | P1       | Vero                 |
| R-OBS-7 | OpenTelemetry tracing with one trace per proposal                                                                    | P2       | Vero, Vouch          |
| R-OBS-8 | Divergence incident view showing both competing messages and their source nodes                                      | P1       | first principles 8.2 |

### 7.10 Operations and user experience (R-OPS)

| ID      | Requirement                                                                                                                             | Priority | Source               |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- |
| R-OPS-1 | Default configuration is A1: three diverse nodes, majority agreement, fan-out publish, embedded ledger, doppelganger on                 | P0       | first principles 8.5 |
| R-OPS-2 | Guided path from A1 to A2 that names the new failure domain covered and the new component to run                                        | P1       | first principles 8.2 |
| R-OPS-3 | `status`, `handover`, `drain`, `ledger` and `cluster` CLI commands                                                                      | P0       | first principles 8.2 |
| R-OPS-4 | Configuration by file, environment and flags, with the cluster definition as the single source of truth                                 | P0       | Lodestar, Vouch      |
| R-OPS-5 | Documented and tested runbooks: rolling upgrade, host loss, key migration, ledger replica replacement, divergence incident, quorum loss | P0       | L15                  |
| R-OPS-6 | Container images and compose or Helm examples for A1 and A2                                                                             | P1       | Vero                 |
| R-OPS-7 | Networks: mainnet, Gnosis, Hoodi, Sepolia, Chiado and custom                                                                            | P0       | Lodestar             |

### 7.11 Post-quantum (R-PQ)

| ID     | Requirement                                                                                                                                                       | Priority | Source               |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------- |
| R-PQ-1 | Ledger schema and reservation API support slot-indexed leaf high-water marks for attester and proposer keys from the first release, even before PQ signing exists | P0       | PQ options 6.1       |
| R-PQ-2 | Signer interface parameterised by EIP-8310 `scheme` with implementation version recorded in the cluster definition                                                | P1       | PQ options 6.8       |
| R-PQ-3 | leanXMSS backend for registration proof of possession, then attestations and proposals as forks activate; deterministic signing verified by test                  | P1       | PQ options 6.9, 6.13 |
| R-PQ-4 | Windowed key preparation replicated across members; offline full-lifetime keygen tooling                                                                          | P2       | PQ options 6.10      |
| R-PQ-5 | Crash-injection tests proving no leaf reuse between reservation and signature release                                                                             | P1       | EIP-8310             |
| R-PQ-6 | Seed custody options: encrypted at rest, Shamir-shared recovery, hardware or enclave holders                                                                      | P2       | PQ options 5         |
| R-PQ-7 | Leaf consumption metrics and budget alerts per key                                                                                                                | P2       | PQ options 6.17      |
| R-PQ-8 | Engagement with EIP-8310 and registry design on standardising the reservation protocol and multi-root redundancy                                                  | P2       | PQ options 8         |

## 8. Success metrics

- Zero slashable or leaf-reusing signatures in fault-injection testing covering: member crash mid-slot, ledger minority loss, ledger partition, stale restore, duplicate member start, signer failover mid-batch, clock skew on one member.
- Planned handover: zero missed duties over 1 000 handovers in test.
- Crash failover: at most one attestation round missed, no proposal missed when the crash occurs more than one lease before the proposal slot.
- Attestation effectiveness in a three-diverse-node A1 deployment at least equal to single Lodestar VC on a healthy node, and higher when one node is down or lagging.
- Reservation latency p99 under 100 ms in-region.
- A new operator reaches a running A1 in under 30 minutes following the documentation.

## 9. Phasing

| Phase                           | Scope                                                                                                                                                                           | Architectures enabled |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1                               | Active-active beacon layer, agreement, fan-out, per-node health and metrics, embedded ledger, slashing detection, doppelganger on all nodes, health endpoint, graceful shutdown | A1, A6                |
| 2                               | Replicated ledger with leases and reservations, cluster definition, handover and drain, signer failover and timeouts, runbooks, dashboards                                      | A2                    |
| 3                               | Active-active mode with idempotent signing, Dirk backend, per-operation node sets, key set partitioning, mTLS everywhere                                                        | A3, A4 backend, A5    |
| PQ track, parallel from phase 2 | Ledger leaf schema, scheme-parameterised signer interface, leanXMSS backend, EIP-8310 keystores, custody options                                                                | all                   |

## 10. Risks

- **Ledger latency.** If a quorum round cannot be kept well under 100 ms in realistic deployments, A2 remains viable but A3 and agreement at shorter slot times suffer. Mitigation: benchmark early with an embedded Raft implementation and colocate replicas with signers.
- **Operational complexity.** A ledger is a new stateful service operators must run. Mitigation: embedded mode for A1, opinionated defaults, replica replacement tooling, and refusing configurations that are unsafe rather than documenting caveats.
- **Post-quantum parameter churn.** Everything but the scheme's structure is provisional. Mitigation: build against EIP-8310's `scheme` object and keep the backend behind an interface.
- **Beacon node load.** Fan-out and agreement multiply requests. Mitigation: one attestation data request per slot per node reused for all committees, as Lodestar and Vouch do; active-passive as the default multi-member mode.
- **Scope creep toward a relay service.** Vouch's embedded relay is attractive but is a separate product. Kept out of scope.

## 11. Open decisions

1. Ledger packaging: embedded Raft inside the VC, separate deployable, or both (recommendation: both, embedded by default).
2. Whether to ship a Lodestar signer daemon (R-SIG-9) or rely on Web3Signer and Dirk behind the interface.
3. Default multi-member mode: active-passive with fast handover (recommendation) or active-active.
4. How much of the beacon layer strategy surface to expose versus fix to defaults.
5. Whether to propose a standard reservation protocol so signers and VCs from other vendors can share a ledger.
6. Language and packaging for the ledger: TypeScript inside the monorepo for one toolchain, or a separate service where a mature Raft library exists.
