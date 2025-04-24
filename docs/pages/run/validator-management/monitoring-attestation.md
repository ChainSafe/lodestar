---
title: Monitoring Attestations
---

# Monitoring Attestations

In Ethereum's Proof of Stake (PoS) consensus mechanism, validators play a crucial role by proposing blocks and attesting to the blocks proposed by others. Attestations are essentially validators' votes. These votes, weighted by the validator's staked Ether, are fundamental to achieving consensus and determining the canonical chain.

Validators broadcast attestations in addition to blocks. These attestations are aggregated and recorded in the Beacon Chain. The Beacon Chain primarily registers validator addresses, their state, and attestations. Validators, activated by staking ETH, run validator clients connected to a beacon node to follow the Beacon Chain. A single validator client can manage multiple validators.

## Validator Participation and Attestation Status

Active validators are scheduled to cast an attestation exactly once per epoch (32 slots), with validators split into committees for each slot. Validators need to ensure their attestations are correctly formed, broadcast, and included in blocks to receive rewards and avoid penalties

The beacon state tracks validator participation in three bits:

1. `timely_source` = is_correct_source and inclusion_delay `<= 6;`
2. `timely_target` = is_correct_target and inclusion_delay `<= 32:`
3. `timely_head` = is_correct_head and inclusion_delay `== 1:`

:::info
If all three flags are true, the validator receives the maximum rewards. If timely_head is true, all other flags are also true.
:::

## Attestation Labels:

For validator operators, understanding why expected rewards aren't achieved is important. The Lodestar attestation_summary metric is designed to help automatically debug these situations. It aims to answer questions like whether an attestation was submitted, seen in an aggregate, or included in a block.

The metric uses specific labels to describe the status of a validator's attestation performance for a given slot:

- `timely_head`: Indicates all participation bits in the state are true, meaning the validator received maximum attester rewards.
- `timely_target_*`: Labels used when the `timely_head` flag is false, but `timely_target` is true.
- `timely_target_next_slot_missed`: The attestation needed an inclusion distance of 1 for `timely_head`. If the next slot is missed, the inclusion distance will be at least 2. But that's the fault of the network, not of this attester.
- `timely_target_wrong_head_vote`: Attestation was included timely in the next slot, but the head vote was incorrect, possibly due to the validator setting the block as head too late.
- `timely_target_no_aggregate_inclusion`: The attestation was never seen in an aggregate, reducing its chance of inclusion by the next block proposer and likely causing an inclusion distance greater than 1.
- `timely_target_late_unknown`: The inclusion distance is greater than 1, but the specific reason is unknown.
- `timely_target_wrong_head_vote_late_unknown`, `timely_target_wrong_head_vote_next_slot_missed`, `timely_target_wrong_head_vote_no_aggregate_inclusion`: These combine the `timely_target_wrong_head_vote` scenario with additional reasons for inclusion distance greater than 1.
- `no_submission`: The validator failed to submit an attestation for the epoch.
- `no_aggregate_inclusion`: The validator submitted an attestation, but it was never included in an aggregate or seen on-chain.
- `aggregate_inclusion_but_missed`: The attestation was seen in an aggregate but was not included in any on-chain blocks.
- `unexpected_*`: Labels used when the beacon node encounters bad states that prevent deriving a valid reason for the attestation status.
- `unexpected_timely_target_without_summary`: Indicates a validator attestation was seen on-chain despite not being submitted to the beacon node, which can occur when using multiple beacon nodes as fallbacks.
- `wrong_target_timely_source`: Indicates `timely_head` is false, `timely_target` is false, and `timely_source` is true. This means the target vote was incorrect, but the attestation was included timely (6 slots). This specific scenario can happen if the attestation slot is the first of the epoch, and importing the head block late causes votes for the wrong head and target.
