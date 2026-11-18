# PQ fork findings

Working notes from implementing the consensus-specs `pq` feature (commit `4dabe73`) in Lodestar with leanVM (`1e674918a`, experimental prover) as the prover. Three kinds of finding: spec deficiencies, implementation difficulties, and measurements.

Measurements are from one machine, an AMD Threadripper 1950X (16 cores, 32 threads, no AVX-512), with `zig build build-exe:bench_pq_signer -Doptimize=ReleaseFast`. They are single runs.

## Spec deficiencies

1. **A leanVM proof does not show which leaf a signature used.** `VerifyAggregates` takes statements of `(pubkeys, leaf_index, message)` and accepts only signatures made at `leaf_index`. The leaf index is the first 4 bytes of a signature, so a raw signature is checked against the leaf its slot or epoch implies. Inside a proof the signature is private input: leanVM proves a set of `(pubkey, message)` claims and its guest constrains the leaf index without publishing it. A key that never reused a leaf is unaffected, since nobody can sign for it at any leaf. A key with one leaf used twice can be impersonated for any attestation inside a proof, by a dishonest aggregator or proposer, where the spec confines the damage to that leaf's own epoch. The fix is small: add the leaf index to leanVM's claim.
2. **The statement is ordered and may repeat, a real proof is a set.** The reference concatenates signatures in statement order, and two attestations in a block may cover the same `(pubkey, message)`. leanVM's claims are strictly sorted and deduplicated. The mapping is sound (prove the sorted union) but the spec should say that order and multiplicity carry no meaning.
3. **`MAX_STARK_PROOF_SIZE` and the claim count are unrelated to the prover.** leanVM caps a merge at 16 children, and proving fails once a node holds more claims than one proof can. A block holds up to `MAX_ATTESTATIONS_PQ = 16` attestations, each spanning many committees, so a mainnet block's proof can need more claims than fit, and merging its aggregates is a tree of recursive proofs. The 1 MiB size cap is loose by comparison: proofs measured here are 160 to 205 KiB.
4. **An empty proof for no attestations is implicit.** The reference accepts empty bytes when there are no statements. A real prover has no proof of nothing, so the spec should state that a block without attestations carries an empty `proof`.
5. **The leaf layout splits a validator's leaves over two bottom trees.** Attestations use leaves from `2^15` and per-slot messages use leaves from `2^15 + 2^29`, so the two are always in different bottom trees of a leanXMSS key (two layers of `2^16`). A signer must keep both built: leanVM keeps the eight a key used last, and building one takes 5 to 6 s on one thread. A per-slot tree lasts 8,192 slots, so a validator client has to build the next one ahead of the boundary or miss duties while it does.
6. **A VRF tree costs far more than the key it accompanies.** Depth 31 means `2^32` SHA-256 calls per validator before it can register: 14.5 s on 32 threads, about 7.7 core-minutes, against 5 core-seconds for the leanXMSS key. It cannot be built lazily, since the root commits to every leaf. An operator with 1,000 validators needs about 5 core-days. The slot index also wraps at `2^31`, since `is_valid_merkle_branch` reads only the low bits.
7. **`IndexedAttestation` reuses a removed field's index.** `Attestation` leaves a gap where `signature` was (`active_fields(width=4, gaps=(2,))`), while `IndexedAttestation` puts the new `proof` at the index `signature` had (`width=3`, no gap). Probably unintended.
8. **Builder exit requests ignore the public key's prefix.** Withdrawal and consolidation requests return early on a legacy (BLS) public key. `process_builder_exit_request` slices `pubkey[16:]` without checking the prefix, so any 16 bytes in front of a builder's key match it. The branch tests this (`builder_exit_request_ignores_pubkey_prefix`), so it is deliberate, and harmless since `source_address` authorizes the request, but it is inconsistent with the other requests.
9. **Linear scans in the hot path.** `get_stored_preregistration_index` scans up to `PREREGISTRATIONS_LIMIT` (524,288) records for every deposit request, of which a payload holds up to 8,192, and `is_pending_validator` scans every pending deposit for every preregistration request. A client needs an index the spec's state does not provide.
10. **Three of the branch's own tests fail.** `make test fork=pq preset=minimal` ends with 3 failures, all in `phase0/fast_confirmation/test_is_one_confirmed.py`.
11. **No real-signature vectors.** The generated vectors run with XMSS switched off: stub signatures, every proof accepted. They exercise the state logic and nothing of the cryptography, and there are no SSZ static vectors for the new containers. Lodestar has no such switch, so it runs them with signature checks skipped, as a caller that verified them beforehand would. Five vectors cannot run that way: they store a preregistration, whose signature block processing must always check because its validity decides the post-state.
12. **Aggregator selection cannot be known ahead.** `is_aggregator` mixes in the finalized root of the head state, so a validator learns whether it aggregates only at the slot. It cannot tell the node at duty time to keep its subnet for aggregation: the validator client here marks every duty as a possible aggregator and decides at the aggregation deadline. An aggregator and a verifier whose head states finalize at different moments disagree, and the gossip rule is REJECT, which penalizes an honest peer.
13. **There is no genesis for a PQ chain.** `upgrade_to_pq` and the test helper are the only ways to a PQ state. A network that starts at PQ needs a specified genesis: validators with leanXMSS keys and VRF roots, the previous fork version, and the genesis bid.
14. **The beacon API has no PQ forms.** Its public key fields are 48 bytes, its validator has no `vrf_root`, and `randao_reveal` is a 96-byte signature. Here the API names a PQ validator by the 48-byte form requests use (16 zero bytes, then the key), drops `vrf_root`, and carries the 1,024-byte VRF proof where the RANDAO reveal and the selection proof went. Proposer preferences and payload attestation messages change size with their signature and need a version to decode.
15. **The engine API has no encoding for preregistration requests.** The spec gives `PREREGISTRATION_REQUEST_TYPE`, and the requests list of `engine_newPayload` and `engine_getPayload` is the natural place. Here it is request type `0x07` after the builder exit requests.
16. **A proposer proves before it proposes.** The block's proof covers every attestation in it, so the proposer merges the proofs of its picks, or proves raw signatures no aggregate covered, between the previous slot's attestations and its own deadline. Nothing in the timing of a slot allows for it.

## Implementation difficulties

1. **The validator type changes.** Every fork before PQ shares one `Validator` container. PQ's has a 32-byte key and a `vrf_root`, so code that reads validators from a fork-neutral state had to become generic, and the fork-neutral list wrapper refuses element access for PQ.
2. **Public key lookup.** The cache maps 48-byte BLS keys to validator indices and holds each key's decompressed point. For PQ it holds the key as deposits name it, 16 zero bytes then the leanXMSS key, with an unused point.
3. **A signature only the state transition can check.** A preregistration with an invalid signature is ignored, not rejected, so its check cannot move to a verifier outside the state transition: the post-state depends on it. Every other PQ signature and the attestation proof can be verified beforehand and skipped during block processing.
4. **leanVM allocates through its own global allocator.** The Rust library is linked into every binary that imports the state transition, and its allocator symbols come from the `leanvm` Zig module, which must therefore be analyzed in each of them.
5. **One aggregation at a time.** leanVM runs one `aggregate` call at a time in a process and queues the rest. A node that aggregates for several committees and then merges as proposer queues behind itself.
6. **Fixed offsets into serialized messages.** Gossip and the database read a slot or a root out of serialized bytes at offsets that assume a 96-byte signature: signed blocks, envelopes, bids, the envelope archive. Each now reads the message's offset, which sits past the signature and so says how long it is.
7. **Types that were one per fork family.** Envelopes, proposer preferences and payload attestation messages had one SSZ type from Gloas on. PQ's differ by the signature, and the envelope by its execution requests too, so every use needs the slot or the fork: gossip topics, req/resp, the database, the API.
8. **Leaf reuse outlives a restart.** What each leaf signed is kept in the validator database beside slashing protection. Attestation and block leaves are already covered by slashing protection, which refuses a second vote for a target epoch and a second block for a slot. Aggregates, payload attestations, envelopes and proposer preferences are not.
9. **Payload attestations have no pool.** A PQ block carries none, so they reach fork choice from gossip and the BLS aggregation pool is skipped.
10. **Signing is single-threaded and slow.** leanVM generates a key, builds a bottom tree and grinds a signature's randomizer on the calling thread. A signature takes 0.3 s on average and varies widely, which is a visible share of a slot's first third, and a validator client with many keys signs as many at once as it has threads. Key generation at 5 s a key made `lodestar dev` start its genesis late until keys were generated before the genesis time was chosen.

## Measurements

| Operation                                 | Time    |
| ----------------------------------------- | ------- |
| leanXMSS key generation                   | 5.3 s   |
| First signature in a bottom tree          | 5.9 s   |
| Later signatures in that tree, mean of 64 | 0.29 s  |
| Signature verification                    | 0.07 ms |
| VRF tree, depth 31                        | 14.5 s  |
| VRF proof after a subtree rebuild         | 10 ms   |

leanXMSS runs on one thread. Signing grinds a randomizer, so single signatures vary widely around the mean.

Aggregation at `log_inv_rate = 2`:

| Signatures | Prove  | Proof size    | Verify |
| ---------- | ------ | ------------- | ------ |
| 16         | 0.16 s | 161,744 bytes | 22 ms  |
| 64         | 0.27 s | 174,860 bytes | 22 ms  |
| 256        | 0.61 s | 190,800 bytes | 23 ms  |
| 1024       | 2.2 s  | 204,892 bytes | 23 ms  |

Merging two aggregates into one takes 0.4 to 0.6 s whatever their size, more than proving 64 signatures from scratch. Through the Node addon 1,400 signatures take 2.9 s. leanVM's own CLI proves them in 2.6 s on this machine, and a 16-to-1 merge of such aggregates in 2.9 s.

Memory: about 2 MiB per loaded key, and 2 MiB more once it has signed. A VRF tree keeps 10 MiB, of which 2 MiB is needed between proofs.

On the devnet below (8 validators, one per committee, minimal preset, node and validator client on this machine) a block was published a median of 0.68 s into its slot and at most 1.9 s, over 47 blocks. That includes proving the block's attestations.

## Running a devnet

```sh
pnpm build
./lodestar dev --genesisValidators 8 --startValidators 0..7 --reset \
  --params.GLOAS_FORK_EPOCH 0 --params.PQ_FORK_EPOCH 0
```

`dev` uses the minimal preset and a mock execution engine. For more nodes give each the same `--genesisValidators` and `--genesisTime`, its own `--startValidators` range, `--dataDir` and ports, and the first node's ENR as `--bootnodes` with `--network.connectToDiscv5Bootnodes`, as `docs/pages/contribution/advanced-topics/setting-up-a-testnet.md` describes. With `PQ_FORK_EPOCH` 0 it builds a PQ genesis state (`initDevStatePq`) whose validators are the interop leanXMSS keys the validator client derives from each index. Interop VRF trees hold secrets for the first 2^20 slots only. Every signature and every proof is real: there is no switch to turn verification off.
