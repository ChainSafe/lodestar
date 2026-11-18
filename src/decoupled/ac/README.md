# Goldilocks available chain

## Source and scope

`ac/available_chain.zig` implements the AC in **Goldilocks**, `fgsa-spec.pdf`, 14 pages, Section 3 and
Figures 7–9. The composition contract comes from Sections 1.4–1.6. The reviewed artifact is
identified by its hash:

SHA-256: `0b501a148734e803bd481ab566d65a78956c03ab3084183d7b5c1fffbebdd8ba`

AC unit tests drive the engine directly with scripted inputs. The real FG is implemented in
`fg/FinalityGadget.zig`; [fg/README.md](../fg/README.md) describes its contract. The shared `Node.zig`
coordinates both engines; [NODE.md](../NODE.md) describes that boundary. The deterministic simulator
uses concrete compile-time dependencies and drives real Nodes with delays, faults, and recovery.
See [testing/README.md](../testing/README.md). Passing these tests does not establish TSQ or a healing
bound.

## Ownership and inputs

The AC owns admitted votes and their receipt times, block receipt times, raw saved confirmations,
lock entries, the latest confirmation record, and the latest fast-confirmed set. It stores blocks only
by root. It does not own a block store, clock, transport, random source, or mutable FG state.

`fg/FinalityFrame.zig` defines the borrowed FG projection:

- `tree`: F followed by its accepted descendants in parent order. Each header names its root, slot,
  parent root, and borrowed AC payload. `tree[0]` is F, not necessarily genesis.
- `fc_root`: a root in that tree.
- `viable_heads`: a membership mask over that frame's headers.

Construct frames with `Frame.init`. Keep headers and payload slices immutable for a call. Rebuild the
frame when FG state changes. The physical FG store can retain blocks outside this F-rooted projection.
Block identities are roots, not frame positions, so a new projection can reindex retained blocks.

`Frame.viableTree(domain)` recomputes witnesses inside the supplied domain. It does not intersect a
cached full viable tree.

The caller supplies:

- Genesis root, validator count and local index, `delta`, `delta_f`, round length, and `k`.
- Exact processing time for each call, including arrivals between public ticks.
- Changing FG frames and one `onBlock` notification per accepted block.
- Already-authenticated vote tuples for `onMessage`; Node verifies the signed wrapper before passing
  the tuple to AC. Block payloads still carry authentication results for `validPayload`.
- Incoming-message order and restart time.

The base protocol has fixed unit-weight validators and `K_s = V`. There is no sampled-committee
schedule. Production adapters must retain real signatures when forwarding tuples; the block payload's
Boolean authentication result is an input abstraction, not cryptographic verification. The FG/Node boundary
must verify block signatures, roots, ancestry, and full state transitions before acceptance.

## Interface

All calls are deterministic and allocation-free after in-place `AvailableChain.init`.

| PDF call           | Zig method     | Result                                                                                  |
| ------------------ | -------------- | --------------------------------------------------------------------------------------- |
| `ac_valid_payload` | `validPayload` | Stateless validity, or an explicit capacity error                                       |
| `ac_on_message`    | `onMessage`    | Named admission outcome                                                                 |
| `ac_on_block`      | `onBlock`      | Stamp an FG-accepted block and admit its carried raw votes                              |
| `ac_on_tick`       | `onTick`       | Optional vote to broadcast; its local admission already happened                        |
| `ac_proposal`      | `proposal`     | Parent and owned ordered payload lists through an output pointer; false when not joined |
| `ac_to_fg`         | `toFG`         | Optional fast-confirmed source and current head                                         |
| `ac_confirmed`     | `confirmed`    | Public confirmation clipped to the current head                                         |
| `ac_head`          | `head`         | Head using the latest due vote slot                                                     |
| `ac_restart`       | `restart`      | Replace volatile AC state while preserving locks and the record                         |

`resolutionTime` also exposes the resolution query for admitted votes. It returns null for infinity.

Payload raw votes and support votes are separate borrowed lists. Order and repetitions remain intact.
Every raw vote must authenticate, belong to V, and name the previous slot. Each support entry must
occur in the raw list. A failure invalidates the whole payload. Node calls this predicate before FG
acceptance; AC's `onBlock` receives only a validated, FG-accepted block.
A head from a later slot is not a payload-validity failure: the vote remains unresolved.

Pool admission separately filters stale/future votes, exact duplicates, and third distinct votes by
one validator. The first two distinct votes retain their first receipt times and acceptance order.
Support-list entries are never ingested as another set of wire votes.

## Time and driving order

`Time` is an integer unit chosen by the caller. `delta` units equal one public tick. Use more than one
unit per tick to exercise arrivals immediately before and after a duty. Slot s begins at
`4 * delta * s`. Genesis has effective receipt time minus infinity; negative-slot pools are empty.

For an awake node:

1. Call `onTick` at every public time, starting at zero.
2. At a slot start, call `proposal` if the node has the proposer duty. Accept its own block immediately
   through FG, then notify AC.
3. At `a_r = 4 * delta * r * R + 6 * delta`, call `toFG` and run the FG action.
4. Process incoming objects stamped at that time in the supplied order.

An emitted vote is already locally admitted when `onTick` returns. Broadcast it without admitting it
again as a new observation. The transport decides delivery times and recipients.

Node rejects skipped/duplicate ticks, events before their same-time tick, reversed processing time,
and times outside the run horizon. Node queries require ticks through the query time. AC no longer
stores a current clock or next-tick field, revalidates frames, or enforces ingress/duty order. Direct
native AC callers must establish the same premises as Node.

`onTickLate` runs the same tick without casting a vote, for a public tick the host reaches late.

At wake, call `restart` before the next duty or incoming object. Restart can skip sleeping ticks. It
keeps lock deadlines and the confirmation record, clears other AC state, and replays frame blocks in
parent order with wake-time stamps. At a public wake time, run that tick next; between public times,
run the next public tick. Only a joined node votes/proposes/unlocks/confirms or supplies an FG source.
The joined guard covers both unlocking and voting in Figure 7 lines 6–9.

## Implemented protocol details

- Strict support and freeze cutoffs use actual receipt and resolution times.
- Current-slot proposals pass the vote freeze with their raw/support lists and ancestry.
- Confirmation walks the F-rooted tree, excludes equivocators from support, and counts them once in
  the participant denominator. A strict majority at F can confirm F even when children split equally.
- Raw confirmations are saved before a live lock veto. A veto writes no lock or fast-confirmed output
  and does not advance the confirmation record.
- Each successful update writes at most one lock, on the deepest fast/slow qualifying ancestor.
  Its deadline is `t_(s+k) + 5 * delta`. Separate deadlines remain separate, even on the same block.
- Rollback excludes equivocators and unresolved heads from opposition, preserves deadlines, and can
  move a lock to F. Expiry occurs at the first public tick at or after its deadline.
- Nonviability does not erase a live lock or its veto. Leaving the F-rooted frame makes it nonlive.
  Unlocking retains only live entries, as Figure 8 specifies.
- The anchor includes viable ancestors of live lock entries and comes from the full viable tree,
  even if outside the frozen voter domain. Head eligibility waives the majority below viable heads
  and for current-slot blocks. Equal scores/depths use the greater root.
- Head reads switch from previous-slot votes to current-slot votes at the support cutoff.
- Public confirmed is the common ancestor of the saved record and current head. It can step backward.
- FG sources come only from the latest update's fast set, filtered against current viability.

## Bounds and evidence

The supported run has at most 64 validators and 64 slots. Frame and receipt-history capacities are
256 blocks. Each payload list has a 128-entry simulation bound (`max_payload_votes`); larger inputs
return `error.PayloadCapacity`, not false validity. Native callers must propagate capacity errors as
incomplete simulation runs. These are not additional Goldilocks wire restrictions.

Admitted pools contain at most two tuples per validator per slot. `VoteSet.zig` stores derived raw
votes and their support flags; it does not own a block tree or implement another fork choice.
During proposal view merge, two distinct tuples preserve all scoring information for an equivocator,
so many individually bounded proposal lists cannot overflow the derived vote set. Raw payload lists
themselves are not truncated.

`available_chain_test.zig` drives moving frames, tick/arrival boundaries, block observations, payloads,
restarts, and deterministic replay. `fg/finality_frame_test.zig` tests frame validation and domain-local
viability. Tests cover veto history, sparse slow locks, same-block deadlines, opposition, exact expiry,
nonviable locks, F advancement, late witnesses, future-head support, equivocation, payload refusal,
full validator-set capacity, large merged bodies, all four interface requirements, and genesis input.

Replay comparisons inspect meaningful fields and active collection entries, not undefined backing
capacity or raw struct padding. No trace-file codec or runner adapter is included in this change.

The simulator owns composed tests, separates sleep retention from partition loss, and draws seeded
Byzantine faults; see [testing/README.md](../testing/README.md). Next: reduction/shrinking and
trace-file replay. Production adapters and NAPI exports remain separate work.
