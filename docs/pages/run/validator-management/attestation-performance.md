---
title: Attestation Performance
---

# Attestation Performance

Most validator rewards come from attestations. This page summarizes how Lodestar
labels attestation effectiveness and how to debug suboptimal performance.

It is based on the [Lodestar attestation summary](https://hackmd.io/@dapplion/lodestar_attestation_summary)
and is complementary to general guides such as
[Lighthouse’s attestation analysis](https://lighthouse-blog.sigmaprime.io/attestation-analysis.html).

## Participation bits

The beacon state tracks attestation participation with three flags:

| Flag | Meaning |
| --- | --- |
| `timely_source` | Correct source checkpoint **and** inclusion delay ≤ 6 slots |
| `timely_target` | Correct target checkpoint **and** inclusion delay ≤ 32 slots |
| `timely_head` | Correct head vote **and** inclusion delay == 1 slot |

If all three are true, the validator earns maximum attester rewards. A timely
head vote implies the other bits are also true for that attestation.

## Status labels

Lodestar’s attestation summary uses labels to explain *why* a validator missed
full rewards. Common labels:

| Label | Meaning |
| --- | --- |
| `timely_head` | All participation bits true; max rewards |
| `timely_target_*` | `timely_head` false, `timely_target` true (see subtypes below) |
| `timely_target_next_slot_missed` | Next slot missed, so inclusion delay ≥ 2; often network/proposer fault, not the attester |
| `timely_target_wrong_head_vote` | Included in the next slot but voted for the wrong head (often head set too late) |
| `timely_target_no_aggregate_inclusion` | Attestation never seen in an aggregate; lowers chance of next-slot inclusion |
| `timely_target_late_unknown` | Inclusion delay > 1 without a more specific cause |
| `no_submission` | Validator never submitted an attestation for that epoch |
| `no_aggregate_inclusion` | Submitted, but never included in an aggregate or on-chain |
| `aggregate_inclusion_but_missed` | Seen in an aggregate but not included in any on-chain block |
| `wrong_target_timely_source` | Wrong target, but source timely (inclusion ≤ 6); common when the attestation slot is the first of an epoch and the head arrives late |
| `unexpected_timely_target_without_summary` | On-chain attestation never submitted to *this* beacon node (e.g. multi-BN fallbacks) |
| `unexpected_*` | Beacon node hit an unexpected state while classifying the attestation |

Combined labels such as `timely_target_wrong_head_vote_no_aggregate_inclusion`
stack the corresponding causes.

## Debugging checklist

Work top-down. Stop when you find a clear root cause.

1. **Did we submit?**  
   Look for `no_submission` or validator/beacon logs that the duty was skipped
   (offline VC, missing keystore, API errors). Fix connectivity and key
   management first.

2. **Was it aggregated?**  
   Labels with `no_aggregate_inclusion` point to gossip, subnet subscription, or
   peer issues between the VC and the mesh. Check peer count, ENR/subnet
   subscriptions, and that the VC talks to a healthy local beacon node.

3. **Was the next slot missed?**  
   `timely_target_next_slot_missed` is often outside the attester’s control.
   Correlate with missed block proposals on the network for that slot.

4. **Wrong head / wrong target?**  
   `timely_target_wrong_head_vote` and `wrong_target_timely_source` usually mean
   the node adopted head too late. Improve BN sync speed, EL latency, and avoid
   attesting through a distant or overloaded beacon node.

5. **Included in aggregates but not on-chain?**  
   `aggregate_inclusion_but_missed` suggests proposer/network inclusion luck.
   Persistently high rates still deserve a look at peer quality and latency to
   proposers.

6. **Multi-beacon setups**  
   `unexpected_timely_target_without_summary` often means another fallback BN
   landed the attestation. Prefer a single primary BN for duties when debugging.

## Metrics and logs to inspect (order)

1. Validator attestation success / inclusion distance metrics (Grafana or your
   scrape target). Prefer epoch-level views over single slots.
2. Beacon node head lag and slot timing (time to import block, time to become
   head).
3. Gossip attestation publish / aggregate seen metrics and errors.
4. Execution layer latency (`engine_newPayload` / forkchoice update timings) when
   head votes are wrong.
5. Validator and beacon logs around the duty slot: attestation produced,
   published, aggregated, and any REST/gRPC errors.

## Related

- [Client monitoring](../logging-and-metrics/client-monitoring.md)
- [Prometheus and Grafana](../logging-and-metrics/prometheus-grafana.md)
- [Validator configuration](./vc-configuration.md)
