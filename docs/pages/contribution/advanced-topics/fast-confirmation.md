---
title: Fast Confirmation
---

# Fast Confirmation

Fast Confirmation is an experimental fork-choice extension that lets Lodestar derive a `confirmed` block that can move ahead of FFG finalization. It is designed for consumers that care about faster operational safety signals, such as bridges, exchanges, custodians, and settlement systems that want something stronger than "current head" but earlier than finality.

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

Lodestar tracks Fast Confirmation inside fork choice and exposes the current view through:

- `GET /eth/v1/lodestar/fast_confirmation_info`

The response includes:

- `confirmed.rootHex` and `confirmed.slot`
- the current `head`
- the current `justifiedCheckpoint`
- the current `finalizedCheckpoint`

This is the consumer-facing API to compare how far `confirmed` is behind or ahead of the usual checkpoint signals.

Example response shape:

```json
{
  "data": {
    "confirmed": {"rootHex": "0x...", "slot": 123},
    "head": {"rootHex": "0x...", "slot": 124},
    "justifiedCheckpoint": {"rootHex": "0x...", "epoch": 3},
    "finalizedCheckpoint": {"rootHex": "0x...", "epoch": 2}
  }
}
```

## How consumers should use it

For bridges, exchanges, and other operators, the practical mental model is:

- if `confirmed.slot` is close to `head.slot`, the chain is showing strong recent support
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
- `CONFIRMATION_BYZANTINE_THRESHOLD` defaults to `25` in Lodestar's chain config. Consumers usually do not need to set it manually unless they are running with a custom config.
- In simple terms, that `25` means Lodestar does not trust all validator votes equally for Fast Confirmation. It asks: "would this block still look safe even if up to one quarter of the relevant voting power tried to pull fork choice toward another branch, voted inconsistently, or did not help at all?"
- A block is only treated as `confirmed` if the remaining honest-looking support is still strong enough under that assumption.
- Consumers should not assume that every Ethereum client exposes the same signal or the same API.
