# Post-Quantum Signing: Options for the Lodestar HA Validator

This document answers one question: how can a high-availability (HA) validator product provide redundancy at the signer layer and safety against double signing once Ethereum validator keys are post-quantum (PQ)? It records the current state of Ethereum's PQ signature plans as of 2026-09-24, explains why the Dirk-style threshold sharding described in [dirk-feature-analysis.md](./dirk-feature-analysis.md) does not carry over, and lays out the design options the HA product must accommodate. Requirements derived here feed the `R-PQ` section of [ha-validator-prd.md](./ha-validator-prd.md).

Statements are marked **confirmed** when directly supported by a cited source and **interpretation** when they are inference. A numbered source list is at the end. The full research notes with 65 sources are preserved in `.research/notes/pq-research.md`.

## 1. Summary

- **The scheme is leanXMSS** (confirmed): a synchronized, stateful, Generalized XMSS with target-sum Winternitz one-time signatures at the leaves, from the Drake, Khovratovich, Kudinov and Wagner paper [1], implemented in `leanEthereum/leanSig` [2] and, in the parameter line clients currently run, in leanVM's `xmss` crate [5]. Tree height 32, so 2^32 leaves. Public key 32 or 52 bytes, signature 1.2 to 3.1 KB depending on parameter line. Every parameter is still provisional; the EF abandoned Poseidon for SHA or BLAKE in August 2026 and the executable spec lags the clients [6][7].
- **The one-time-key index is the slot** (confirmed). EIP-8310 calls this `synchronized` mode: "refusing to double-sign a slot is exactly refusing to reuse a leaf" and delegates state authority to the EIP-3076 slashing protection database [3]. Validators hold two stateful keys, one for attestations and one for proposals [8].
- **Two different messages at one index compromise the key** (confirmed). The leaked chain values let an attacker forge signatures for that key. Unlike slashing this is silent, immediate and exploitable from the gossip network [3][9][10].
- **The same message twice is safe only because the implementations are deterministic** (confirmed). Both reference implementations derive the encoding randomness by PRF from seed, epoch and message, so identical inputs yield identical bytes [2][5]. The paper's abstract construction samples fresh randomness, so this is an implementation property the HA product must pin [1].
- **There is no Dirk-style m-of-n sharding** (confirmed). Black-box threshold signing of any hash-based scheme is impossible against a dishonest majority [11]. The published constructions need a trusted dealer, lack distributed key generation, or run the hash inside MPC, and none targets leanXMSS or is integrated with any distributed validator stack [12][13][14]. Obol, SSV, Lido and Attestant have published nothing on PQ.
- **Consequence for HA** (interpretation). Redundancy for a PQ validator key means replicating the whole seed to several signer instances and enforcing exactly one signed message per key per slot across all of them, with strict consistency and fail-closed behaviour. That is today's slashing protection problem with a far higher penalty for getting it wrong, and it is the same coordination primitive Devo, Dirk and a shared Web3Signer database already approximate.
- **Timeline** (confirmed). The PQ public key registry lands at fork I*, PQ attestations at L* or possibly K\*, with full resistance targeted for December 2029 [15]. From the registry fork onward every validator holds a registered but unused PQ key that the HA product must already protect.

## 2. What changes relative to BLS

| Property                         | BLS today                     | leanXMSS                                                                                          |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Key material                     | 32-byte scalar                | 32-byte seed; the full key is deterministic from the seed [3][5]                                  |
| Key generation                   | Instant                       | Hours for a full 2^32-leaf tree; seconds for a windowed key that commits to the same root [4][16] |
| Signing state                    | None                          | One leaf per slot; the set of signed slots is the state [3]                                       |
| Signing the same message twice   | Harmless                      | Harmless only with deterministic randomness; otherwise leaks [1][2]                               |
| Signing two messages at one slot | Slashable, penalty            | Key compromise, silent, forgery possible immediately [9][10]                                      |
| Linear secret sharing            | Yes, basis of Dirk, Obol, SSV | None; no algebraic structure to share [11]                                                        |
| Signature size                   | 96 bytes                      | 1,208 to 3,116 bytes [5][7]                                                                       |
| Aggregation                      | BLS addition by any party     | Recursive proof by an untrusted aggregator role; the VC needs no new cryptography for it [17]     |
| Keys per validator               | One                           | Two, attester and proposer, plus possibly a RANDAO hash chain secret [8][18]                      |
| Keystore                         | EIP-2335                      | EIP-8310 v5 with a `scheme` block and a non-authoritative `state` snapshot [3]                    |

Two further protocol facts matter for HA design:

- **Aggregation enforces one message per epoch per key.** leanVM's recursive aggregation rejects two claims at one epoch with different messages, so a replica that signs late with stale fork choice both endangers the key and contributes nothing [19].
- **Reserved leaf ranges exist only for counter mode.** EIP-8310 section 5 lets a keystore partition its leaf space into disjoint ranges for concurrent signers, with "a range MUST NOT be assigned to more than one signer instance simultaneously" [3]. In synchronized mode the index is the slot, so every replica would need the same leaf for the same duty and partitioning does not help consensus keys. It does apply if any duty ends up using counter mode, for example builder bids.

## 3. Why sharding does not transfer

Dirk, Obol and SSV rely on BLS linearity: Shamir shares of the secret scalar yield partial signatures that combine by Lagrange interpolation into one standard signature, with no per-signature coordination. A hash-based key has no such structure. The secret is a seed expanded through hash chains, and a signature is a set of chain intermediates plus a Merkle path. Sharing the seed yields nothing unless the hash function is evaluated on shares inside a multi-party computation.

The research landscape (confirmed):

- **Impossibility.** Kumar, Kondi and Vanegas show there is no protocol secure against a malicious majority that realises the signing algorithm of any hash-based scheme in a black-box manner [11].
- **Kelsey, Lang and Lucks** transform XMSS or LMS into distributed and threshold schemes, but require a trusted dealer, a common reference value of up to several gigabytes per key, and two round trips per signature between an aggregator and each trustee [12].
- **PRAWNS** (Boneh, Bünz and others, published 2026-09-21) thresholdizes Winternitz and XMSS via a threshold PRF with verifier-transparent output, but has no distributed key generation, its scalable variant imports a lattice assumption on the signer side, and it requires the threshold to exceed (n + f)/2 so that an honest party sits in every possible quorum. The paper cites Ethereum's leanSig as motivation and has no implementation [13].
- **MPC of hash chains** achieves sub-second three-party signing for Poseidon2, the hash Ethereum is now moving away from [14].

Conclusion (interpretation): threshold signing of a leanXMSS key is not available at any cost today. The PRAWNS quorum condition is the cryptographic restatement of the operational rule the HA product must enforce anyway: no two replicas may sign independently. The product should abstract its signer backend so a threshold backend can be added if one matures, but must not depend on one.

## 4. The safety problem restated

With the index bound to the slot, the invariant the HA product must guarantee is:

> For each key and each slot, at most one distinct message is ever signed, across all replicas, across all restarts, forever.

Three corollaries shape the design:

1. **The slashing protection database is the OTS state authority.** EIP-8310 says so explicitly for synchronized mode [3]. The product's replicated signing ledger therefore carries two duties at once: preventing slashable messages for BLS and preventing leaf reuse for PQ. Build it once, strictly consistent, and use it for both.
2. **Duplicate identical requests are benign; divergent requests are fatal.** Because signing is deterministic, two replicas asking for a signature over byte-identical attestation data can both be served, and a signer can answer the second from a cache. Any difference in the message bytes, for example a head root disagreement between two beacon nodes, is a different message and must be refused.
3. **Stale restore is the dominant operational risk.** EIP-8310 requires that import with fresh state be a hard error for a consumable key, that implementations detect a regression of the high-water mark and refuse to sign until reconciled, and that the index be durably persisted before the signature is computed or released [3]. NIST SP 800-208 imposes the same ordering and notes that buffered writes are insufficient [10].

## 5. Options

The options below are not mutually exclusive. The recommended baseline is A plus B plus C; D through G are complements or future upgrades.

### Option A: Whole-key replication with a single active signer, lease and fencing

Replicate the seed to N signer instances. At any time exactly one holds a time-bounded lease to sign for a given key set, granted by a strongly consistent coordination service (a Raft group, etcd, or the signing ledger itself). Every signature commit records the lease's fencing token alongside slot and message hash; a signer whose token is stale is refused at commit time even if it believes it holds the lease. Failover time is bounded by the lease duration.

- Provides: redundancy against signer host loss; safety against concurrent signing as long as the coordination service is correct and clocks stay within the lease's assumed bound.
- Costs: a coordination service in the trust base; a lease-length trade-off between failover speed and clock skew tolerance; a signer must fail closed whenever it cannot confirm its lease.
- This is the active-passive shape of Vero's Automatic Failover, hardened with fencing.

### Option B: Quorum-reserved signing ledger

Run N ledger replicas that hold, per key, the high-water marks for attester and proposer slots and a map from slot to message hash. A signer sends a reservation request (key, slot, message hash) to all replicas and signs only after a majority have durably accepted it. A replica accepts a slot at most once per key; a second request with a different hash for the same slot is refused. Two signers with divergent messages cannot both obtain a majority.

- Provides: safety against divergent signing even with several active signers, tolerance of a minority of ledger replicas failing, and a natural place for EIP-8310's commit-before-sign persistence.
- Costs: one quorum round trip per signature, which must fit comfortably inside a slot and ideally under 100 ms; ledger replicas are the trust base for safety, so a colluding or buggy majority could approve two messages; the ledger needs its own backup, membership and reconfiguration story.
- This is the open-source shape of Vero's Devo, made strict. Combined with Option A it provides both liveness (one active signer) and defence in depth (quorum refuses divergence even if leasing fails).

### Option C: Deterministic signing with an idempotent signature cache

Pin one deterministic implementation of leanXMSS across every replica. Persist (key, slot, message hash, signature) at commit time. A request that matches an existing entry byte for byte returns the stored signature without recomputing; a request that matches slot but not hash is refused. This makes duplicate requests from active-active validator clients safe by construction and avoids the fault-injection concern NIST raises for modules that re-sign [10].

- Provides: safe active-active at the validator client layer; graceful handling of retries and of the same duty arriving from several VC instances.
- Costs: storage of one signature per slot per key (1 to 3 KB per slot); the guarantee is void if any replica uses a different randomness derivation, so the implementation and its version must be part of the ledger's configuration.

### Option D: Agreement on message content before signing

Reuse the multi-beacon-node consensus features from Vero and Vouch (attestation data agreement above a threshold, majority head root) so that replicas feeding the same beacon node set almost always request identical messages. This lowers the rate at which the ledger has to refuse divergent requests and therefore the rate of missed duties, but it is a mitigation of liveness, not a safety mechanism. Safety must still come from A or B.

### Option E: Multiple independent PQ keys per validator

NIST's recommended pattern for distributing a stateful key across modules is several independent keys with a verifier that accepts any of them [10]. The registry design already floats registering two or three Merkle roots per validator for hash agility [4]. If the protocol accepted a set of roots per validator for redundancy, each replica could hold its own key and sign independently, restoring the "no coordination" property that BLS sharding provides today. This is not in any spec and is a protocol question the Lodestar team could raise in the registry discussion; it should be tracked, not relied on.

### Option F: Hypertree subtree distribution

With more than one hypertree layer, bottom subtrees could be generated on different signer instances and certified once by the top-level key, so instances sign independently from disjoint subtrees (NIST SP 800-208 section 7) [10]. EIP-8310 fixes `hypertree_layers: 1` and the paper lists multi-tree as future work [3][1]. Not available in the current parameterisation; also does not solve the synchronized-mode problem because the slot picks the leaf.

### Option G: Threshold signing backend

Keep the signer backend pluggable so that a Kelsey/Lucks, PRAWNS or MPC construction can be adopted if one reaches production quality. Note that every candidate still needs a dealer or a strong quorum condition, so it would complement rather than replace the ledger.

### Seed custody is a separate problem

Sharding gave Dirk a second property beyond availability: no single machine ever held a whole key. Whole-seed replication gives that up. Options to compensate, from cheapest to strongest: encrypt the seed at rest per EIP-8310 and restrict which hosts may hold it; Shamir-share the seed for backup and recovery only, reconstructing it solely inside a hardware security module or enclave on the active signer; or hold the seed only in modules with non-exportable keys and monotonic counters as NIST recommends. This is threshold custody, not threshold signing, and it does not change the single-signer-per-slot rule.

## 6. Capabilities the HA product must include

Independent of which options are chosen, the following are required for PQ compatibility. They are phrased as capabilities so they can be lifted into the PRD.

**Signing ledger**

1. Strictly consistent, replicated store of per-key high-water marks for attester slots and proposer slots, plus a slot to message hash map. No eventual consistency and no "sign if the ledger is unreachable" path.
2. Commit-before-sign: reservation durably persisted with fsync before the signature is computed or released, matching EIP-8310 and NIST SP 800-208.
3. High-water mark regression detection: refuse to sign for a key whose ledger state is older than the last known state until an operator reconciles.
4. Idempotent sign with a signature cache keyed on (key, slot, message hash).
5. Fencing tokens tied to a lease, so a signer that lost its lease cannot commit.
6. Support for counter-mode keys with reserved disjoint leaf ranges per signer instance, for any duty that ends up using counter mode.
7. The same ledger enforces EIP-3076 rules for BLS keys during the hybrid window, so one component protects both key types.

**Signer**

8. A `scheme` parameterised backend as in EIP-8310, expecting at least one more parameter change before mainnet, with the implementation version recorded in the ledger configuration.
9. Deterministic signing pinned across replicas; refuse to start if replicas report different implementations.
10. Windowed key preparation replicated across signer instances so every replica can sign for the current slot range; keygen for the full lifetime is an offline, one-time operation.
11. Separate handling of attester and proposer keys, and of any additional sequential-consumption secret such as a RANDAO hash chain.
12. Sync-lag gate: never sign for a slot that has already passed the local wall clock by more than a configured bound, so a replica catching up cannot consume past leaves.
13. Registration support: the proof of possession is one XMSS signature and consumes a leaf; it must go through the ledger like any other signature.

**Key lifecycle and operations**

14. EIP-8310 keystore v5 import and export with the Recover versus Resume distinction enforced: importing a consumable key with fresh state is a hard error.
15. Seed backup and recovery procedures separate from state backup; documented reconciliation steps after a state loss.
16. Crash-injection tests between signature computation and state persistence demonstrating no reuse on restart, as EIP-8310 requires.
17. Metrics: leaf consumption per key, ledger quorum latency, refused divergent requests, high-water mark regressions detected, lease changes.

**Validator client**

18. Signing requests carry the full message so the ledger can hash and compare it, not just a signing root.
19. Active-active VC instances are acceptable only because the signer and ledger enforce the invariant; the VC must treat a refusal as final for that slot and never retry with different data.
20. Attestation data agreement across beacon nodes to keep divergent requests rare (Option D).

## 7. Implications for the HA architecture

- The **signing ledger is the product's core**, not an add-on. It is what allows several validator client instances and several signer instances to coexist safely for both BLS and PQ keys. Competitors approximate it with Dirk's per-instance rules plus a majority threshold, or with Vero's closed-source Devo. An open, strictly consistent ledger with PQ semantics is a differentiator no competitor has published.
- **Sharding is not a product requirement.** Dirk-style threshold BLS should be supported as a backend for today's keys, but the safety story must not assume it, because it will not exist for PQ keys.
- **The hybrid window starts at the registry fork.** The product must protect PQ seeds and their state several forks before PQ attestations go live, and must run BLS and PQ protection side by side afterwards.
- **Parameters will change.** Everything about the scheme except its structure is provisional. Build against the EIP-8310 `scheme` object and the leanSig and leanVM interfaces, and plan for at least one incompatible parameter rotation.

## 8. Open questions

1. Will any consensus duty use counter mode, making reserved leaf ranges relevant for HA?
2. Will the registry accept several roots per validator for redundancy rather than only for hash agility?
3. Which duties need which key once aggregator selection, RANDAO and sync-committee-like messages are specified for the PQ chain?
4. What ledger latency budget is acceptable at 4-second slots, and can a quorum round fit alongside attestation data agreement?
5. Does the team want to pursue hardware-backed custody for seeds, given NIST's recommendation and EIP-8310's software-only posture?
6. Should Lodestar propose an HA-oriented amendment to EIP-8310 or the registry design, for example standardising the ledger reservation protocol so signers and VCs from different vendors interoperate?

## Sources

1. Drake, Khovratovich, Kudinov, Wagner, "Hash-Based Multi-Signatures for Post-Quantum Ethereum", IACR ePrint 2025/055. https://eprint.iacr.org/2025/055
2. leanEthereum/leanSig, `src/signature/generalized_xmss.rs`. https://github.com/leanEthereum/leanSig
3. EIP-8310, "Post-Quantum Keystore for Stateful Keys" (Draft, 2026-06-19). https://eips.ethereum.org/EIPS/eip-8310
4. Coratger et al., "Exploring the Design Space for a Post-Quantum Public Key Registry for Ethereum Validators", ethresear.ch (2026-06-01). https://ethresear.ch/t/exploring-the-design-space-for-a-post-quantum-public-key-registry-for-ethereum-validators/25040
5. leanEthereum/leanVM, `crates/xmss`. https://github.com/leanEthereum/leanVM
6. Justin Drake, announcement of the Poseidon to SHA/BLAKE pivot (2026-08-13). https://x.com/drakefjustin/status/2087905684180418733
7. leanSpec issue #1210, spec versus client parameter mismatch (2026-09-22). https://github.com/leanEthereum/leanSpec/issues/1210
8. leanEthereum/pm, pq-devnet-4 notes (attestation key plus proposer key). https://github.com/leanEthereum/pm/blob/main/breakout-rooms/leanConsensus/pq-interop/pq-devnet-4.md
9. RFC 8391, "XMSS: eXtended Merkle Signature Scheme", sections 1.1, 3.1, 4.1.12. https://www.rfc-editor.org/rfc/rfc8391.html
10. NIST SP 800-208, "Recommendation for Stateful Hash-Based Signature Schemes", sections 7, 8.1, 9.1. https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-208.pdf
11. Kumar, Kondi, Vanegas, "Black-Box Threshold Signing of Hash-Based Signatures is Impossible", NIST MPTS 2026. https://csrc.nist.gov/presentations/2026/mpts2026-4b4
12. Kelsey, Lang, Lucks, "Turning Hash-Based Signatures into Distributed Signatures and Threshold Signatures", IACR CiC 2(2), 2025. https://cic.iacr.org/p/2/2/24
13. Boneh, Bünz et al., "PRAWNS: Threshold Hash-Based Signatures from Threshold PRFs", IACR ePrint 2026/2142 (2026-09-21). https://eprint.iacr.org/2026/2142
14. Adomnicăi, "Towards Practical Multi-Party Hash Chains using Arithmetization-Oriented Primitives", IACR CiC 2(4), 2026. https://cic.iacr.org/p/2/4/23
15. EF Blog, "EF Protocol: Current and Emerging Priorities" (2026-09-07). https://blog.ethereum.org/2026/09/07/protocol-priorities
16. blockblaz/hash-zig, windowed key generation timings. https://github.com/blockblaz/hash-zig
17. Goat Research, "From Aggregate Signatures to Aggregate Proofs" (2026-08-26). https://hackmd.io/@goatresearch/H1G2tOCwGx
18. EIP-8321, "Hash-Chain RANDAO" (Draft, 2026-07-05). https://eips.ethereum.org/EIPS/eip-8321
19. leanSpec issue #1209 and leanVM issue #278, one message per epoch in aggregation proofs (2026-09-20). https://github.com/leanEthereum/leanSpec/issues/1209
