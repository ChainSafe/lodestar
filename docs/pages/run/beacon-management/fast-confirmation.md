---
title: Fast Confirmation
---

# Fast Confirmation

Fast Confirmation is an experimental fork-choice extension that lets Lodestar derive a `confirmed` block earlier than FFG can finalize one. It is designed for consumers that care about faster operational safety signals, such as bridges, exchanges, custodians, and settlement systems that want something stronger than "current head" but earlier than finality.

## What it is

At a high level, Fast Confirmation asks a narrower question than finality:

- Is there already enough honest attestation support behind this branch that an adversary with bounded weight should not be able to move fork choice away from it?

If the answer is yes, Lodestar marks a block as `confirmed`.

That signal is useful when a consumer needs a better "safe to act on" checkpoint than head, for example:

- an exchange deciding when a deposit is safe to credit internally
- a bridge deciding when a source-chain event is safe enough to relay
- an operations team measuring how far the node's safe view lags the head

## What it is not

Fast Confirmation is not a replacement for Ethereum finality.

- `head` can move quickly and is the most optimistic view
- `confirmed` is a stronger safety signal than head, but may still move or reset after a reorg
- `finalized` is the strongest settlement signal and has the full FFG safety guarantee

For bridge and exchange policies, the practical interpretation is:

- use `head` for liveness-sensitive monitoring
- use `confirmed` when you want a faster, fork-choice-based safety signal
- use `finalized` when your policy requires consensus finality

## What Lodestar exposes

Lodestar tracks Fast Confirmation inside fork choice and publishes confirmations through the standard beacon-API event stream ([beacon-APIs #598](https://github.com/ethereum/beacon-APIs/pull/598)):

- `GET /eth/v1/events?topics=fast_confirmation`

Each event fires once per slot when the Fast Confirmation Rule executes and carries:

- `block` — the confirmed beacon block root
- `slot` — the slot of the confirmed beacon block
- `current_slot` — the clock slot at which the Fast Confirmation Rule executed

Example event:

```
event: fast_confirmation
data: {"block": "0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2", "slot": "1", "current_slot": "2"}
```

To compare the confirmed block against the chain's `head` and `finalized_checkpoint`, consumers can subscribe to multiple event topics in a single stream (e.g., `GET /eth/v1/events?topics=fast_confirmation,head,finalized_checkpoint`), or fetch the same data from the standard beacon-API REST endpoints (`/eth/v1/beacon/headers/head` and `/eth/v1/beacon/states/head/finality_checkpoints`).

## How consumers should use it

For bridges, exchanges, and other operators, the practical mental model is:

- if `confirmed.slot` is one or more slots behind `head.slot`, the chain may still be showing strong recent support
- if `confirmed.slot` stalls while `head.slot` advances, attestation support is weaker or more ambiguous
- if `confirmed` resets toward `finalized`, Lodestar detected that the previous confirmed branch no longer met the rule's safety conditions

That makes Fast Confirmation a risk signal, not only a progress signal.

The practical policy is:

- treat `confirmed` as stronger than head, but weaker than finality
- use it as an internal safety signal, not as a replacement for consensus finality
- monitor the gap between `head`, `confirmed`, and `finalized`
- alert on repeated `confirmed` resets or prolonged stalls
- keep finality-based policies for the highest-value or highest-risk operations

## Important caveats

- Fast Confirmation is currently experimental and disabled by default.
- Enabling it requires the node operator to turn on `--chain.fastConfirmation`.
- `CONFIRMATION_BYZANTINE_THRESHOLD` defaults to `25` in Lodestar's chain config and can be configured with `--params.CONFIRMATION_BYZANTINE_THRESHOLD` for custom deployments.
- In simple terms, that `25` means Fast Confirmation remains safe under the assumption that up to one quarter of the relevant staked balance could be malicious, adversarial, equivocating, or unhelpful.
- A block is only treated as `confirmed` if the remaining honest-looking support is still strong enough under that assumption.
- Consumers should not assume that every Ethereum client exposes the same signal or the same API.
- For external simulator data and cross-client comparison, see the EthPandaOps [FCR simulator report](https://ethpandaops.io/posts/fcr-simulator/) and [fastconfirm.it](https://fastconfirm.it/).
