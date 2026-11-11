# PQ fork findings

Working notes from implementing the consensus-specs `pq` feature (commit `4dabe73`) in Lodestar with leanVM (`e5d75f8`) as the prover. Three kinds of finding: spec deficiencies, implementation difficulties, and measurements.

Measurements are from one machine, an AMD Threadripper 1950X (16 cores, 32 threads, no AVX-512), with `zig build build-exe:bench_pq_signer -Doptimize=ReleaseFast`. They are single runs.

## Spec deficiencies

1. **A leanVM proof does not show which leaf a signature used.** `VerifyAggregates` takes statements of `(pubkeys, leaf_index, message)` and accepts only signatures made at `leaf_index`. The leaf index is the first 4 bytes of a signature, so a raw signature is checked against the leaf its slot or epoch implies. Inside a proof the signature is private input: leanVM proves a set of `(pubkey, message)` claims and its guest constrains the leaf index without publishing it. A key that never reused a leaf is unaffected, since nobody can sign for it at any leaf. A key with one leaf used twice can be impersonated for any attestation inside a proof, by a dishonest aggregator or proposer, where the spec confines the damage to that leaf's own epoch. The fix is small: add the leaf index to leanVM's claim.
2. **The statement is ordered and may repeat, a real proof is a set.** The reference concatenates signatures in statement order, and two attestations in a block may cover the same `(pubkey, message)`. leanVM's claims are strictly sorted and deduplicated. The mapping is sound (prove the sorted union) but the spec should say that order and multiplicity carry no meaning.
3. **`MAX_STARK_PROOF_SIZE` and the claim count are unrelated to the prover.** leanVM caps a proof below 65,536 claims and a merge at 16 children. A block holds up to `MAX_ATTESTATIONS_PQ = 16` attestations, each spanning many committees, so a mainnet block's proof can need more claims than fit, and merging its aggregates is a tree of recursive proofs. The 1 MiB size cap is loose by comparison: proofs measured here are 190 to 245 KiB.
4. **An empty proof for no attestations is implicit.** The reference accepts empty bytes when there are no statements. A real prover has no proof of nothing, so the spec should state that a block without attestations carries an empty `proof`.
5. **The leaf layout defeats a two-layer key's cache.** Attestations use leaves from `2^15` and per-slot messages use leaves from `2^15 + 2^29`, so the two are always in different bottom trees of a leanXMSS key (two layers of `2^16`). A signer that keeps one bottom tree, as leanVM does, rebuilds one on every switch: about 0.4 s on 32 threads, 5 core-seconds. Every aggregation or proposal duty pays two rebuilds. Lodestar works around it with two instances of each key.
6. **A VRF tree costs far more than the key it accompanies.** Depth 31 means `2^32` SHA-256 calls per validator before it can register: 14.5 s on 32 threads, about 7.7 core-minutes, against 0.4 s (5 core-seconds) for the leanXMSS key. It cannot be built lazily, since the root commits to every leaf. An operator with 1,000 validators needs about 5 core-days. The slot index also wraps at `2^31`, since `is_valid_merkle_branch` reads only the low bits.
7. **`IndexedAttestation` reuses a removed field's index.** `Attestation` leaves a gap where `signature` was (`active_fields(width=4, gaps=(2,))`), while `IndexedAttestation` puts the new `proof` at the index `signature` had (`width=3`, no gap). Probably unintended.
8. **Builder exit requests skip the legacy check.** Withdrawal and consolidation requests return early on a legacy (BLS) public key. `process_builder_exit_request` slices `pubkey[16:]` without checking the prefix, so any 16 bytes in front of a builder's key match it. Harmless, since `source_address` authorizes the request, but inconsistent.
9. **Linear scans in the hot path.** `get_stored_preregistration_index` scans up to `PREREGISTRATIONS_LIMIT` (524,288) records for every deposit request, of which a payload holds up to 8,192, and `is_pending_validator` scans every pending deposit for every preregistration request. A client needs an index the spec's state does not provide.
10. **Three of the branch's own tests fail.** `make test fork=pq preset=minimal` ends with 3 failures, all in `phase0/fast_confirmation/test_is_one_confirmed.py`.
11. **No real-signature vectors.** The generated vectors run with XMSS switched off: stub signatures, every proof accepted. They exercise the state logic and nothing of the cryptography, and there are no SSZ static vectors for the new containers. Lodestar has no such switch, so it runs them with signature checks skipped, as a caller that verified them beforehand would. Five vectors cannot run that way: they store a preregistration, whose signature block processing must always check because its validity decides the post-state.

## Implementation difficulties

1. **The validator type changes.** Every fork before PQ shares one `Validator` container. PQ's has a 32-byte key and a `vrf_root`, so code that reads validators from a fork-neutral state had to become generic, and the fork-neutral list wrapper refuses element access for PQ.
2. **Public key lookup.** The cache maps 48-byte BLS keys to validator indices and holds each key's decompressed point. For PQ it holds the key as deposits name it, 16 zero bytes then the leanXMSS key, with an unused point.
3. **A signature only the state transition can check.** A preregistration with an invalid signature is ignored, not rejected, so its check cannot move to a verifier outside the state transition: the post-state depends on it. Every other PQ signature and the attestation proof can be verified beforehand and skipped during block processing.
4. **leanVM allocates through its own global allocator.** The Rust library is linked into every binary that imports the state transition, and its allocator symbols come from the `leanvm` Zig module, which must therefore be analyzed in each of them.
5. **One aggregation at a time.** leanVM must not run two `aggregate` calls at once in a process, and signing shares its thread pool. A node that aggregates for several committees and then merges as proposer queues behind itself.

## Measurements

| Operation | Time |
| --- | --- |
| leanXMSS key generation | 0.39 s |
| First signature in a bottom tree | 0.42 s |
| Later signatures in that tree, mean of 64 | 20 ms |
| Signature verification | 0.07 ms |
| VRF tree, depth 31 | 14.5 s |
| VRF proof after a subtree rebuild | 10 ms |

Signing grinds a randomizer, so single signatures vary widely around the mean. On one thread key generation takes 5.1 s and a warm signature 0.28 s on average.

Aggregation at `log_inv_rate = 2`:

| Signatures | Prove | Proof size | Verify |
| --- | --- | --- | --- |
| 16 | 0.26 s | 189,840 bytes | 23 ms |
| 64 | 0.32 s | 206,736 bytes | 20 ms |
| 256 | 0.81 s | 226,616 bytes | 21 ms |
| 1024 | 2.8 s | 243,272 bytes | 22 ms |

Merging two aggregates into one takes about 0.65 s whatever their size, more than proving 64 signatures from scratch.

Memory: about 2 MiB per loaded key, and 2 MiB more once it has signed. A VRF tree keeps 10 MiB, of which 2 MiB is needed between proofs.
