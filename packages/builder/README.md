# Lodestar Builder

[![Discord](https://img.shields.io/discord/593655374469660673.svg?label=Discord&logo=discord)](https://discord.gg/aMxzVcr)
[![Eth Consensus Spec v1.7.0-beta.4](https://img.shields.io/badge/ETH%20consensus--spec-1.7.0_beta.4-blue)](https://github.com/ethereum/consensus-specs/releases/tag/v1.7.0-beta.4)
![ES Version](https://img.shields.io/badge/ES-2021-yellow)
![Node Version](https://img.shields.io/badge/node-24.x-green)

> This package is part of [ChainSafe's Lodestar](https://lodestar.chainsafe.io) project

Typescript implementation of the Ethereum Consensus builder client.

## Getting started

- Follow the [installation guide](https://chainsafe.github.io/lodestar/) to install Lodestar.
- Quickly try out the whole stack by [starting a local testnet](https://chainsafe.github.io/lodestar/contribution/advanced-topics/setting-up-a-testnet/).

## Requirements

- Start the beacon node with `--emitPayloadAttributes`. Otherwise it only emits
  payload attributes for its own proposal slots.
- Configure either an execution client with Engine API access or the incremental
  constructor described below. The builder requires Gloas to be scheduled.

## Limitations

Won bids reserve their value for three epochs. Their payments only leave the
builder's beacon balance when withdrawals are processed, so a longer withdrawal
backlog can cause the publisher to overestimate available balance. Reconciling
the publisher ledger with pending payments and withdrawals remains necessary.
Beacon-side bid validation checks these liabilities; disabling that check does
not remove the publisher limitation.

## Recovering proposer preferences

Proposers gossip their signed preferences once. A beacon node that misses the message never
emits the matching event, and the builder does not bid for that slot. The builder polls the
pool of its beacon node at startup and once per slot. Additional trusted beacon nodes on the
same network can be polled as well:

```sh
--proposerPreferences.urls http://127.0.0.1:9597,http://127.0.0.1:9598
```

At most three additional URLs are accepted. Each is verified against the genesis and config of
the primary beacon node before its pool is used; a node on a different network is excluded for
the rest of the process. Only signed preferences for the current and next epoch are retained, and
entries are merged by proposal slot and dependent root, so an entry already known is never
replaced. The primary beacon node still provides payload attributes, duties and builder status.
Polls share one deadline, `--proposerPreferences.timeout`, and run outside the bidding path; a
failing node is reported once and skipped until it responds again.

## Controlled payloads on a devnet

The builder can use Geth's `testing_buildBlockV1` to build an exact, ordered list of signed transactions.
This experimental source supports Gloas payloads without blob transactions. It preserves the beacon
node's payload attributes, including withdrawals, randomness, parent beacon block root, slot and target
gas limit. The builder's configured execution fee recipient is applied as usual.

Create a JSON transaction plan:

```json
{
  "transactions": [],
  "extraData": "0x"
}
```

Replace the empty array with signed transaction hex strings in execution order. An empty array builds
an empty payload; `null` is rejected. Transactions must have valid nonces, balances and fees for the
requested parent. Optional `parentHash` and `slotNumber` fields bind the plan to one parent or slot.
The builder reads the file for each new build; replace it atomically when updating a plan.

Add these flags to your existing builder command to capture payloads without submitting bids:

```sh
--payload.transactionsFile /path/to/transactions.json \
--payload.testingUrl http://127.0.0.1:8545 \
--payload.outputDir /path/to/captures \
--payload.dryRun
```

Use a private Geth HTTP endpoint with the `eth` and `testing` namespaces enabled, for example
`--http --http.addr 127.0.0.1 --http.api eth,testing`. This source does not support IPC or use the
authenticated Engine endpoint. Geth must already follow the beacon node's requested execution parent.
The source checks that parent against Geth's current head and does not change forkchoice.

Capture mode still requires the existing builder key, active builder identity and proposer preferences.
It saves the raw RPC request and response, including the block access list and execution requests,
along with build timestamps. It stops before signing or storing a bid. Omit `--payload.dryRun` to use
the ordinary bidding and reveal flow with the controlled payloads.

Geth's synchronous testing build can continue after the proposal deadline. The source waits for its
RPC response before allowing another build, captures late results, and discards them from bidding.
Choose `--execution.timeout` and Geth's HTTP timeouts to cover the expected build duration. If the RPC
times out or disconnects during a build, its completion is unknown: check Geth and restart the builder before
building again. A completed build that fails validation or capture is not retried for the same request.

The adapter checks transaction order and returned attributes. Validate captures with another EL before
using a new workload on a shared devnet; these checks do not independently verify execution or roots.

## Incremental payload constructor

An external constructor can keep one session alive and return improving Gloas
payloads, including complete blob bundles. Add these flags to the existing builder command:

```sh
--payload.constructorUrl http://127.0.0.1:8547 \
--bidding.updateIntervalMs 100 \
--bidding.updateCutoffBps 1000
```

The constructor implements the private JSON-RPC methods `zbuilder_beginV1(parentHash,
payloadAttributes, extraData?)`, `zbuilder_getPayloadV1(sessionId, knownBlockHash?)` and
`zbuilder_endV1(sessionId)`. Begin returns `{sessionId}`. Get returns a complete Engine
payload response or `null` when the supplied hash is still current. The constructor
must validate execution before exposing a result. When extra data is omitted, the
constructor chooses it, for example to identify its software revision; the result
must fit the execution payload's 32-byte limit. Lodestar additionally checks the
parent and attributes. Construction and intake remain external; Lodestar owns pricing,
signing, bid publication and reveal obligations.

With updates enabled, the API immediately offers each strictly higher bid permitted by
the pricing policy. Earlier signed revisions and payloads remain available for selection. Gossip
still publishes at most one bid per slot and parent tuple for the configured identity,
using the best ready bid at `bidding.deadlineBps` in the preceding slot. API polling
continues until `updateCutoffBps` of the proposal slot; 1000 is 1.2 seconds into a
12-second slot. Parent changes cancel construction without deleting old commitments.

`--bidding.deferUnusedGossipStages` is disabled by default. With updates and staged
identities enabled, a stage skipped solely because its value is below the gossip
floor can wait for a higher durable API revision within its original window.
The identity must have no signed revision for those parents and no pending or
uncertain revision admission for that slot, including other parents. The deferral
reason describes the identity's computed bid value after pricing and collateral
checks; it does not prove that the payload is missing value. It starts preparation
at most once, with a 25 ms budget covering signing, retention and acknowledgement
and 10 ms reserved before the next stage or update cutoff. The timer cannot interrupt
synchronous signing; expiry is checked again before gossip. Timed-out retention still preserves any late durable
commitment, but cannot trigger gossip or another attempt. Cancellation, generation
eligibility and the exact integer gossip floor are checked again before sending.
The `BUILDER_STAGED_GOSSIP_DEFERRED` log records the wait; subsequent gossip or skip
logs include `deferredMs`. This option does not extend any deadline or retry an
uncertain send.

### Temporary Hoodi fork transition

The temporary Hoodi branch keeps `--assumeBuilderIndex` and
`--assumeBuilderBalanceGwei` together. Before Gloas it uses that identity, then
checks its public key against the registry. A different registered index stops
bidding rather than signing with the wrong identity.

`--payload.engineUntilSlot` selects the Engine through that proposal slot,
inclusive; the native constructor starts at the next slot. Each build keeps its
original owner across the boundary, including late replies and cleanup. Engine
retrieval occurs 300 ms before the configured gossip deadline and its complete
snapshot is reused. Native failures after the cutoff do not fall back to Engine.
Both alternate request modes are rejected before Engine allocation. Only native
snapshots support retained permissions and primary transfer; permission renewal
and cleanup remain attached to the exact original payload after worker release.

`--bidding.subsidyUntilSlot` also includes its cutoff slot. It does not change the
configured gossip deadline, share, or update cutoff. These temporary options are
independent of deferred staged gossip and alternate gossip.

### Recoverable constructor allocation

With a compatible native constructor, enable `--payload.beginReservations true` to
reserve a single-use session identity before beginning construction. A lost reserve
response cannot allocate a worker. A lost begin response remains counted against
capacity until `zbuilder_cancelBeginV1` confirms that the worker and any delayed begin
have been cleared. Begin is never retried; cleanup retries use the known reservation.
This option does not enable alternate branches or bundle cancellation.

The constructor must implement `zbuilder_reserveBeginV1`, `zbuilder_beginReservedV1`
and `zbuilder_cancelBeginV1` with protocol version 1. This opt-in has no legacy
fallback. Reservations are scoped to one native process instance, so a native restart
requires coordinated publisher restart and recovery of its durable reveal journal.
Routing a reservation to another instance fails closed and keeps its capacity
uncertain. A cleanup timeout also retains capacity; later reconciliation may recover
it without restarting either process. Already signed payloads remain available for reveal.

## Experimental alternate parent bids

The builder can retain an API and stream bid for additional parent tuples using the
same builder identity. Enable this on the beacon node:

```sh
--chain.emitPayloadAttributes true \
--chain.emitPayloadAttributesAlternates true \
--chain.payloadAttributesAlternateBuilderIndices 0
```

Replace `0` with the primary builder's registered index. On the builder, keep session
updates enabled and add `--bidding.alternateBranches true`. The constructor must
support `zbuilder_beginAlternateV1(parentHash, payloadAttributes, extraData?)`, returning
`{sessionId, orderGenerationVersion: 0, alternateSessionVersion: 1}`. This method rejects
renewable order-generation leases before allocating a session. Older constructors
cannot silently accept this request as ordinary session work.

For a constructor running order generations, explicitly enable
`--payload.alternateOrderGenerations true` as well. It defaults to false and requires
alternate branches and continuous primary updates. The publisher first requires
`orderGenerationVersion: 1` and `retainedOfferVersion: 1` from the primary begin.
An older constructor cannot be treated as supporting the new permission protocol.
With generations disabled, the existing unleased alternate path remains in use.

`--bidding.alternateGossip true` also offers those durable alternate bids over P2P
using the primary builder identity. It defaults to false and requires both
`--bidding.alternateBranches` and `--payload.alternateOrderGenerations`. Publication
starts no earlier than the unchanged primary gossip deadline and stops at the
ordinary update cutoff. It waits for that primary publication to settle, or for
the primary to skip a previously prepared bid that is no longer eligible. A
primary that has not produced a prepared bid for its current tuple keeps the
gate closed until cutoff, including when its policy declines every snapshot or
after a late parent change. A slow primary request can prevent alternate gossip
for that slot; there is no timeout that releases competing requests while it
remains pending. Lease renewal continues during the wait.
It reuses a signed, retained bid without another build,
signature or journal write. The latest retained owner for each parent tuple must
still have valid branch metadata, proposer preferences, collateral and a current
generation lease when transport starts. Transport never blocks lease renewal.
Each `(slot, builder index, EL parent hash, CL parent root)` gets one attempt,
including uncertain sends; previously signed payloads remain available for reveal.
Recovered journal tuples conservatively do not gossip again. Additional staged
identities continue to serve only the primary construction path.

The [Gloas gossip rules](https://github.com/ethereum/consensus-specs/blob/d9663f85be248c4fd0ae95806da6070e17c2442b/specs/gloas/p2p-interface.md#new-execution_payload_bid)
allow distinct parent tuples for one identity, but receivers forward only branches
compatible with their own head choice. FULL and EMPTY variants can therefore
reach different peers; publication acknowledgement does not establish reception
or proposer selection. Lodestar also checks its predicted parent for a direct-parent
bid at an epoch boundary. This option does not relax those beacon rules.

`--bidding.primaryHandoff true` additionally allows an already durable primary bid
to survive a same-slot, same-proposer change of primary parent. It defaults to
false and requires retained alternate permissions plus the constructor's explicit
`primaryHandoffVersion: 1` capability. With the second worker free at demotion,
one conditional `zbuilder_retainPrimaryPayloadV1` request has at most 25 ms before
normal worker release. The new primary starts independently. Native must confirm
the exact current hash, parents, slot, namespace and generation. No execution,
signature or journal write is repeated. The grant is unavailable to callers until
fresh alternate attributes, dependent root, preferences, builder identity and
collateral authorize the unchanged signed value. Missing metadata releases the
grant after at most the configured alternate duration, within the ordinary offer
cutoff. The request counts toward the existing four-attempt slot cap; a lost
response is not retried and remains subject to native token expiry.
An absent or malformed optional namespace leaves ordinary primary bidding intact
but cannot authorize a transfer. Adoption conservatively requires the full payload
attributes to match, including safe and finalized hashes. A refused or expired
transfer preserves captured alternate metadata for normal bounded reconstruction
under the current eligible primary, including a further same-slot parent switch.

In this opt-in mode, `zbuilder_beginAlternateV2` (or the separate
`zbuilder_reserveAlternateBeginV1` reservation) allocates the spare worker.
`zbuilder_getRetainedPayloadV1` atomically copies a candidate and grants permission
for its exact block hash, both parents, slot, namespace and generation. The worker
is then released normally. Small `zbuilder_renewPayloadOfferV1` reads renew that
permission every 100 ms, each for at most 250 ms measured before sending the read.
The native table holds at most eight metadata records, no workers or payload bytes.
The records expire at payload timestamp plus 1200 ms or 24 seconds of monotonic
time, whichever comes first. Full tables reject new grants without evicting live
ones; release, expiration or a generation change recovers capacity. Every read
owns a distinct grant even for identical bytes. A tuple's incumbent stays owned
through temporary lease lapses and is replaced only after a new offer is retained;
late cleanup of the old grant cannot revoke the replacement. Unused or late read
results are released, independently of physical worker cleanup. Lost responses
whose IDs never reach the publisher remain bounded by native expiry.

Each renewal rechecks authoritative branch metadata, proposer preferences, dependent
root, builder status, collateral and the publication cutoff. A pending primary
context pauses permission with an epoch that invalidates in-flight renewals.
Resolving the same context wakes a serialized renewal immediately. A changed
context, unavailable preferences or the end of the primary job closes permission.
The resulting pause still includes the duties RPC and one renewal round trip;
measure that gap during a canary. Cancellation fences
old grants even after their workers have ended. A new bounded construction may
authorize a lower-value payload in the new generation; an old token is never
updated to that generation. Such reconstructions share the existing four-attempt
limit and spare worker. Only a committed owner's terminal renewal queues
reauthorization; repeated attributes for a recorded but unadopted tuple do not
authorize extra attempts. A bounded reconstruction intent survives a temporary
primary role, unresolved duties or a full queue, and is consumed when an attempt
starts. It is discarded when its slot or branch context is no longer valid.
A generation-not-ready initial acquisition gets at most
one retry within that same cap and deadline, after confirmed cleanup. Initial
branches take priority. All previously signed
payloads remain available for reveal, and recovered journals never restore offer
permission. No additional gossip is scheduled by these renewals.
An incumbent's temporary lease lapse does not lower the value floor for its
refresh. A grant in a newer generation of the same namespace proves that the old
incumbent is fenced and can authorize a lower-value replacement immediately.
Grant owners share the payload store's immutable transaction and blob
bodies, including same-hash replacements, while keeping independent permission
and valuation metadata. This sharing guarantee covers grant owners; primary
session copies and bounded in-flight retrieval/admission copies are separate.

Local protocol tests use authenticated fixture state and canned Engine replies;
they do not establish independent block validity or competitive improvement.
Qualify a separate canary before enabling this mode: compare requested-parent
availability and value before actual publication, primary update latency, deadline
lateness, worker cleanup and cancellation behavior on the same workload.

The existing `payload_attributes` event carries alternate tuples in an optional
`context` object containing `role: "alternate"`, `dependent_root`, and `builders`.
Ordinary events have no context and keep their existing wire format. No additional
event topic or subscription is required. Alternate tuples cover the current beacon
head and its direct parent, each with available FULL and EMPTY variants. EMPTY excludes the
parent execution payload; the new block can still contain transactions. Each context
uses its own prepared state, withdrawals and execution requests. The event includes
the proposer dependent root and branch-specific identity/collateral metadata for at
most 16 configured builder indices. A differing proposer or dependent root, a missing
cached state, or missing/ineligible builder metadata causes that alternate to be skipped.
Enable beacon emission only on a dedicated builder endpoint whose subscribers all
understand the context extension. An older subscriber can ignore unknown metadata
and treat every alternate as its new primary. Upgrade the publisher first, then
enable alternate emission on the beacon node.

Keep `chain.fastConfirmation` disabled (the default). Alternate events are suppressed
with fast confirmation because its safe execution hash can be ahead of an alternate parent.

Alternates start only after a primary snapshot with no active lease is retained, or
an eligible leased snapshot when retained alternate permissions are enabled. One spare native
worker produces one alternate snapshot at a time, with at most four attempts per slot.
`--bidding.alternateBuildDurationMs` defaults to 500 ms and accepts 250 through 1000 ms.
Construction stops for a new primary and does not start near scheduled gossip or too
late to finish before the slot. An unpublished alternate preempted by a primary change
may retry once for the same slot, proposer and dependent root. The retry counts toward
the four-attempt limit and waits for confirmed cleanup and a retained primary bid.
Cleanup continues to occupy capacity until the native constructor confirms it.
Without begin reservations, an unknown allocation outcome disables further alternates.
With begin reservations, confirmed cancellation recovers capacity after a lost reply.
Half of the revision, payload-byte and payload-count admission limits remains reserved
for primary work. Alternates enter the durable journal only while it is idle.

`--bidding.alternateRefreshBeforeSlotMs` defaults to `0` (disabled). With alternate
branches enabled, values from 500 through 5000 schedule one last refresh for each
retained alternate tuple, targeting that many milliseconds before the proposal slot.
The start is clamped to at least 100 ms after the configured primary gossip deadline,
so a larger lead cannot add work before that deadline.
This also covers an earlier primary that is subsequently received as an authoritative
alternate event. Builder eligibility and collateral must come from that event; an old
primary alone cannot authorize a refresh. Events for the current primary are ignored,
so a context received only before the primary changes does not schedule a refresh.

Refreshes share the four-attempt limit with initial snapshots and preemption retries.
Queued branches not yet attempted take priority, and a preempted refresh is not retried.
A refresh replaces an eligible API offer only when its value increases. Earlier signed payloads
remain available for reveal. A snapshot that fails to retain an offer does not schedule
another refresh. Context, preferences, spare-worker capacity and journal availability
are checked again before retention.

The refresh lead is a scheduling target, not a reserved execution window. It can be
delayed or skipped by primary work, gossip deadlines or admission limits. It must leave
more than the build duration plus 50 ms before the slot. For example, with a 500 ms
build duration, primary gossip at 9250 bps and stages at 9850/10000/10400/10800 bps,
an 800 ms lead starts 100 ms after the primary deadline, with 70 ms of admission slack
before the first stage's exclusion window. A 750 ms lead leaves only 20 ms, so a small
timer delay or busy journal can skip the refresh. A 500 ms lead cannot fit and is
skipped. Choose a lead against the actual gossip schedule and measure primary
performance before enabling it.

To qualify the scheduler separately from native construction, run:

```sh
pnpm --filter '@lodestar/builder...' build
node --expose-gc packages/builder/test/perf/alternateParentRefresh.mjs > refresh-results.json
```

This compares refresh off/on over two alternating pairs with identical synthetic
transaction arrivals, roughly 130 transactions per late payload and real wall-clock
scheduling, signing and worker-backed durable journals. It reports retained alternate
value, primary revisions, stage timing, journal costs, CPU time and timer gaps. The fake
provider performs no transaction execution or proof loading, and its transport has fixed
delays. Those results cannot establish the native constructor cost or live fee gains;
follow with an isolated canary while monitoring primary throughput and bid timing.

This initial mode publishes alternate bids through HTTP and WebSocket only. Primary
and staged gossip behavior is unchanged. Previously advertised payloads remain retained
for reveal when a new primary replaces their branch. The work limits can omit contexts;
enabling this option does not guarantee a bid for every possible parent.

The default update interval is zero, retaining one retrieval at the usual deadline.
Positive intervals require this constructor source and must be at least 25 ms. This
source cannot be combined with the controlled transaction-file source or its capture
directory. `--payload.dryRun` builds without signing or publishing.

The beacon node emits `payload_attributes` once per slot, at two thirds of the slot before
the proposal. To start construction earlier, run the builder's beacon node with
`--emitPayloadAttributes --chain.emitPayloadAttributesEarly`. It then also emits as soon
as the parent of the next slot is known: the empty tuple when the block is imported and
the full tuple when its execution payload is imported. The regular emission before the
slot still follows, so one slot may deliver the same tuple twice and the empty tuple before
the full one. The builder keys builds by tuple, and a changed tuple cancels the earlier build.
Epoch boundaries keep the regular timing only.

The commitment journal permits 256 signed revisions per slot across all parents.
Payload storage is capped at 1,280 payloads and 256 MiB of retained content plus entry
allowances, with a 64 MiB admission budget per slot. Identical immutable blob sidecars
share storage within a slot; metadata and proof accounting remain conservative.
This accounting is not a resident memory limit. Exhaustion rejects new work rather than evicting
advertised payloads. Metrics distinguish prepared API revisions (`prepared`) from
successful gossip publication (`published`). Keep the constructor RPC private.

Live CLI builders persist Gloas commitments to `<dataDir>/builder-commitments`.
Payloads and signed bids are synced before exposure; reveal conflict records are
synced before signing. Recovery restores reveal obligations and checks identity,
checksums, execution-request roots and required payloads before serving. Each
new offer must match its retained slot, execution hash, execution parent, beacon
parent, request root and ordered blob commitments. Reusing an immutable payload
hash cannot replace those retained bindings. The disk journal is limited to
768 MiB, 51,457 files and 128 MiB per file. Payloads expire after two slots;
bid and reveal metadata expire after three epochs. Dry runs do not write it.

New offers leave software quota for 25,088 reveal records of at most 1 KiB each
(24.5 MiB), within those same total limits. Existing reveal files consume that
reserve. Both ordinary writes and staged hard links preserve the remaining
headroom; no previous offer is deleted to make room. Existing journals above the
new offer threshold still recover, but cannot guarantee the reserve until old
records expire. This accounting does not reserve physical blocks or protect
against ENOSPC, filesystem corruption, a failed disk or a disk that ignores fsync.

Recovery conservatively consumes each recorded parent tuple's gossip allowance
and reserves the largest offer per recent slot as a possible unsettled liability.
This covers missed selection events while offline, but can reduce available bidding
balance until reconciliation or expiry. Startup also processes the current beacon
head. An uncertain write stops new journal writes. Before recovery or signing,
the builder takes a native exclusive lock in the canonical commitment directory.
It rejects a second instance, including symlink aliases and another instance in
the same process. The lock has no stale timeout: a stopped process remains the
owner, while an exited process releases its kernel lock. Shutdown revokes new
signing first, drains journal workers, then releases ownership. A successor must
recover all commitments before serving. Use a local filesystem with reliable
exclusive locking and atomic-rename/fsync semantics, retain the data directory
across upgrades, and drain existing offers before switching publisher identities.
Never remove or replace the `.writer-lock` directory while an owner may be alive.
Signer ownership is acquired only from the main thread. A process-wide directory
registry rejects duplicate opens before they can release a POSIX record lock;
other code in that process must not open, repair or destroy `.writer-lock/LOCK`.
The lock database itself needs writable disk space at startup. An unavailable or
corrupt lock database fails startup closed, even if expired journal files could
otherwise be pruned. Preserve the directory until the former owner has exited.
The guard covers the primary identity and its configured staged identities under
one commitment root. Separate data directories, copied disks, copied keys and
snapshot rollback are not fenced. Cross-host failover needs an external signer
or fencing system and a journal that includes every acknowledged offer. This
local guard does not provide replicated recovery or make the builder mainnet ready.

After synchronous startup recovery, one worker owns journal writes and pruning.
Its queue admits at most eight offers, 64 MiB of offer data and sixteen operations.
Reveal records have reserved capacity and priority over queued offers. An offer
becomes eligible only after its durable acknowledgement; queued writes and writes
with uncertain outcomes consume revision admission. Existing ready bids can still
be served while a newer revision is being persisted.

Blob bytes, commitments and cell proofs are stored together in content-addressed
binary files shared by revisions of the same slot. Payload records retain ordered
references; recovery checks their hashes and bid commitment order. Legacy inline
blob records remain readable. Older binaries cannot recover live reference-based
payload records: before rolling back, pause new construction and drain beyond the
two-slot payload retention window. Preserve the journal and identity files; never
replace the journal with a backup that omits bids already exposed to proposers.

## Constructor order generations

A constructor advertising `orderGenerationVersion: 1` uses conditional
`zbuilder_getPayloadV2` reads. Each ready response grants 250 ms of offer permission,
measured from the request start with both monotonic and wall clocks. Heartbeats may
renew unchanged candidates. Expired, unavailable, released or superseded generations
cannot produce new API or gossip offers. Checks run after durable preparation, before
each transport attempt and before the final API response is sent. API responses use
`Cache-Control: no-store`.

The gateway must fence the constructor and drain all outstanding leases before
acknowledging cancellation or replacement. Lower-value replacement candidates may be
served through the API; already consumed gossip allowances are not reset. Previously
signed bids and payloads remain retained for reveal, even after cancellation. Recovery
restores these obligations without restoring volatile offer permission; a current
constructor admission is required before offering them again.

This protocol requires session updates. One-shot construction with leased candidates
is rejected. Constructors advertising version zero, or no version, retain V1 behavior.
Deploy a compatible gateway, constructor and publisher together before enabling order
generations. Attempts authorized before a fence can arrive after its acknowledgement
because of scheduling or network delay. Cancellation does not retract delivered bids, remove
independently authorized copies, or fence copied processes on other hosts. Arbitrary
VM snapshot rollback and clock restoration are outside the lease assumptions.

## HTTP bid response timing

HTTP bid requests keep the proposer's `Date-Milliseconds` as the timeout anchor.
The default wait reserves the request age for the reply and another 50 ms for
scheduling and serialization. Request age includes connection setup, queues and
clock offset; it is not a measurement of the return path.

`--builderApi.httpReturnReserveCapMs` optionally caps that mirrored reply allowance
(integer 0–10000 ms). For example, age 158 ms and timeout 400 ms give a 34 ms wait
by default, or 132 ms with a 60 ms cap and the unchanged 50 ms margin. This is an
operator assumption: a slower return path can cause a timeout. The cap defaults
to unset, affects HTTP only, and never moves the client deadline. Cloudflare
timestamp headers do not replace that deadline, and other callers' request ages
are not used to learn it.

`--builderApi.httpResponseMarginMs` independently sets scheduling/serialization
headroom (integer 20–1000 ms, default 50). Keep it at 50 while testing a return cap.
The served-bid log records request age, reply allowance, planned wait and how late
the bid was ready against that plan. The API request log records remaining client
budget at origin response completion, before the unmeasured return trip. These
logs cannot prove that the proposer received the complete response on time; use
client-side completion/timeout evidence for that.

The manual loopback test `node packages/cli/test/perf/bidResponseTiming.mjs` (after
building the builder and CLI) exercises real authenticated routes with controlled
transport delays. It includes both a fresher on-time capped response and a slower
return path where the same cap times out. It does not measure a production path.

## Experimental Gloas bid streaming

Enable `--builderApi --builderApi.bidStream` to serve the WebSocket extension used by
[Commit-Boost v0.12.0-rc1](https://github.com/Commit-Boost/commit-boost-client/releases/tag/v0.12.0-rc1)
and [Helix PR #670](https://github.com/gattaca-com/helix/pull/670). This is an experimental
extension, not a replacement for the standard HTTP builder API. The normal POST bid,
preferences and signed-block routes remain available.

```text
GET /eth/v1/builder/execution_payload_bid_stream/{slot}/{parent_hash}/{parent_root}/{proposer_pubkey}
Eth-Consensus-Version: gloas
Date-Milliseconds: <request send time in Unix milliseconds>
X-Timeout-Ms: <total request timeout in milliseconds>
X-Request-Auth: <standard padded base64 of SSZ SignedBuilderRequestAuth>
```

The upgrade authenticates the proposer, slot and agreed auth data exactly as HTTP does.
With `--builderApi.publicUrl https://builder-plataberget.nflaig.dev`, the proposer's
`auth_data` is the UTF-8 hostname `builder-plataberget.nflaig.dev`, unless
`--builderApi.authData` overrides it. The JSON auth object is not sent in this header;
serialize it as SSZ before base64 encoding. A successful upgrade sends binary messages:
byte `0x01` (frame version), byte `0x07` (Gloas), then SSZ `SignedExecutionPayloadBid`.
Clients must retain the latest valid message, including a lower replacement after an
order-generation change.

For Commit-Boost, set `get_header = "stream"` on the existing builder relay entry:

```toml
[[relays]]
id = "plataberget-builder"
url = "https://<registered-builder-pubkey>@builder-plataberget.nflaig.dev"
get_header = "stream"
```

Use the actual registered builder key and the appropriate network configuration.
Commit-Boost opens one stream per bid request and can fall back to HTTP if the upgrade
fails. A repeated proposer request opens a new stream and can return a newer bid.

The stream sends an eligible retained bid immediately, then updates after durable
retention. By default it keeps the same inbound transit reservation and 50 ms margin
as HTTP; ping/pong RTT is diagnostic only and does not change its send or close deadline.

Adaptive timing is separately opt-in with `--builderApi.bidStreamAdaptiveTiming`,
which defaults to false and requires `--builderApi --builderApi.bidStream`. Enable
it only after verifying end-to-end pong forwarding through the exact deployment path.
It does not assume that Cloudflare or another intermediary forwards control frames.

In adaptive mode, before authentication it fixes a hard stop at the earlier of the requested
slot's end and the caller's timeout minus observed inbound age and a 50 ms margin.
The initial send cutoff also reserves that inbound age for the return path, as HTTP
does. One matching pong can set the send cutoff to reserve the full measured RTT,
rounded up, before the fixed hard stop. It never grants a new timeout or assumes a symmetric path.

If the initial send cutoff passes before the pong arrives, the stream pauses bid
frames while retaining the single probe only while its full RTT could leave send
time, and never beyond the fixed hard stop. This probe bound cannot shorten the
initial send window. A matching pong
can resume frames only if time remains after reserving its full RTT. Missing,
unmatched, repeated or late pongs cannot extend the hard stop. A future request
timestamp disables waiting. The conservative pre-upgrade check remains unchanged:
authentication that exhausts the initial budget returns HTTP 204, even if the hard
stop is later. This adaptation does not resolve those 204 responses or infer clock
offsets from request headers.

The measured RTT must reach the authenticated proposer connection. Use direct or
transparent WebSocket proxying; an intermediary that answers pings instead of
forwarding them measures only the path to that intermediary. Verify control-frame
forwarding before enabling this mode behind a proxy. The reserved RTT is a measured
sample, not a guarantee of future return-path latency.
The sample conservatively includes local setup and queuing of the first bid frame
before the ping is sent. Pongs received after the hard stop or after the stream has
stopped are not recorded.

Close logs distinguish the initial and final send windows from the hard stop and
socket lifetime. `durationMs` includes the closing handshake and is not the active
send window. There are at most 64 pending or open
streams, four per authenticated proposer, one write in flight and one coalesced update indication per
connection. A 25 ms local eligibility check observes lease renewal without fetching or
building a payload. Client data frames are rejected; compression is disabled. A peer
that does not complete close is terminated after 100 ms.

Every send rechecks current offer permission after serialization. Previously sent bids
remain durably retained for reveal. Closing a stream, cancellation, or a newer message
does not withdraw a bid already delivered to a proposer. Streaming does not enable
constructor order generations or alter gossip identities, pricing or construction timing.

## Staged P2P bids

Gloas peers accept at most one gossip bid per builder index, slot and parent tuple.
To advertise later improvements over P2P, configure additional **registered** builder
identities with `--bidding.gossipIdentitiesFile /path/to/gossip-identities.json`:

```json
[
  {
    "keystore": "keystore-builder-1.json",
    "keystorePassword": "../secrets/builder-1-password.txt",
    "deadlineBps": 9750
  },
  {
    "keystore": "keystore-builder-2.json",
    "keystorePassword": "../secrets/builder-2-password.txt",
    "deadlineBps": 10000
  }
]
```

Paths are relative to the configuration file. `builderPubkey` is an optional expected
public key for each entry. Keep the existing primary keystore flags. For example,
with `--bidding.deadlineBps 9250` on a 12-second network, the primary bids 900 ms
before the proposal slot, followed by stages at 300 ms before and at the slot boundary.
Propagation and commitment persistence add latency, so measure arrival times before
choosing a schedule. A stage at or after the boundary may miss an early proposer.

There is one construction session. Each extra stage uses the latest durable primary
snapshot, computes a bid under its own balance and unsettled liabilities, and signs
with its own identity. The configured pricing policy applies to every identity.
A later stage must exceed the largest previously attempted value by Lodestar's gossip
increment: 3%, with a 100,000 gwei floor and 10,000,000 gwei cap. Competitors may already
have a higher bid. API requests continue to return revisions signed by the primary.
If the primary's balance caps its API revisions, this also limits the staged snapshot
feed, even if an additional identity has more balance.

If a richer primary revision becomes ready during a stage's durable preparation, the
stage may prepare that newer revision once before gossip. The first preparation must
fit within a 25 ms refresh budget, with another 10 ms left before the next stage or
update cutoff. Slower initial preparations keep their original bid. The optional
preparation's asynchronous wait has a timeout of at most 25 ms; a timeout or
failure falls back to the first durable bid if it remains eligible and within the
stage window. There is no repeated chasing or second gossip. Both signed payloads
remain retained, including when the journal acknowledgement arrives after the timeout.

Gossip logs separate `initialPrepareMs`, `refreshMs`, `refreshAttempted` and
`refreshTimedOut` from `publishMs`. `BUILDER_STAGED_GOSSIP_SKIPPED` logs distinguish
`publication_pending` from preparation failures, including for stages without a refresh.
A `stage_expired` preparation skip with
`refreshAttempted: true` counts as a lost stage during optional refresh, not a successful
freshness improvement. The timer starts after synchronous signing and journal enqueue;
it cannot preempt that work or a stalled event loop. The 10 ms scheduling margin does
not guarantee completion of the beacon request. Compare gossip timing, subsequent
stages skipped for a pending publication, and expired stages as well as newer bid value
and the refresh-attempt rate in a canary.

At most four additional identities are accepted. Their deadlines must strictly increase
after the primary deadline and remain before `10000 + bidding.updateCutoffBps`.
Session updates and a durable commitment directory are required. Unknown identities fail
startup with a bounded registry request (one retry for transient failures); known inactive or underfunded identities skip
bidding. A missed stage, an insufficient increase, or a preceding publication still in
flight skips that stage. Uncertain sends are retained and never retried for that tuple.

Each identity has a separate ledger and a durable journal under
`<commitmentDir>-gossip/<pubkey>`. These directories must accompany the primary journal
through backups and deployments. Startup refuses to omit a configured signer whose journal still contains an outstanding
commitment. Keep those keys available and drain bidding before removing an identity. Shared payloads stay in
memory until the normal reveal retention expires, and each journal independently holds
the payloads needed to recover that identity's commitments.

## Order cancellation evidence

The optional `--builderApi.orderExposureTokenFile /run/zbuilder/order-exposure.token`
setting enables `POST /internal/v1/order-exposure` on the builder API listener.
The file contains 64 lowercase hexadecimal characters, optionally followed by a
newline. It is read once at startup. Requests use that value as a Bearer token;
the route is absent without this setting. Keep the route private and give access
only to the gateway that owns the native generation fence. Public owner
authorization belongs to the gateway.

Native snapshots carry `orderMetadata` with a version, at most 256 immutable
order IDs, and a `doNotOfferBefore` timestamp in Unix milliseconds. Missing
metadata or `orderIds: null` means unknown membership. New signing, persistence,
HTTP responses, stream frames, gossip, and retained offer permissions check the
timestamp. Historical signed payloads remain available for reveal after a
cancellation or a clock change. Reusing a payload hash or signed bid root with
different membership is refused.

Every primary and staged journal persists membership with the existing durable
signature write. A durable signed commitment means **possible exposure**,
including when its transport result or persistence acknowledgement is unknown.
This is not evidence of selection, a canonical block, or finality.

The capability response provides a publisher instance, coverage start, and
`observedAtUnixMs` from the publisher clock. The gateway records that observation
as a conservative admission lower bound before durable admission and live feed;
it must not substitute its own clock. After the native generation drain
acknowledgement, an authenticated query waits up to one second for all identity
journal barriers. The response echoes the exact order ID, namespace and
generation. It searches all retained matching commitments, including those older
than the admission bound.

Absence requires a matching continuously covered publisher instance and complete
history covering admission. Legacy records, unknown membership, lost journal coverage,
detected clock discontinuities, missing identities, or incomplete barriers
prevent an absence claim. A retained positive is still reported when another
journal is unavailable. Each journal bounds its evidence index to 8,192 records
and 16 MiB; exceeding either limit makes absence unavailable for that instance.
Queries return at most 64 commitments, with a total count and truncation marker.
There is one active query per publisher and a 1 KiB request limit. A response
timeout keeps that query occupied until its outstanding journal work settles.
The journal barrier also waits for a shared reference's snapshot fallback, and
its queue slot does not consume the existing capacity for reveal writes.

Publisher and journal clocks are checked against their initial monotonic clock
observations. A difference above 10 ms permanently disables absence claims for
that instance. Every prune checks the clock. When a complete bid record is
removed, its exact order IDs remain remembered; a query for one of those IDs
returns unknown unless a retained positive commitment is still available.
Pruning known empty or unrelated records does not invalidate absence for other
orders. Missing or incomplete records still advance the global coverage
boundary to at least the prune time plus a conservative 22 ms margin; an
admission before that boundary cannot regain absence merely by waiting.

Each journal remembers at most 8,192 distinct pruned order IDs. Repeated IDs do
not consume additional entries. Exceeding that limit permanently disables
absence for the publisher instance before any remembered IDs are discarded,
including for queries with later admission bounds. Retained positive evidence
remains available. Restarting creates a new instance that cannot certify
absence for orders admitted under the old instance. This bounded history is
not an archival guarantee for sustained private order flow.

New bid records use the version 2 journal envelope. The new reader preserves old
records and their exact reveal payloads, but treats their exposure metadata as
unknown. **Do not roll back to an older binary after writing new records.**
Preserve every identity journal and use a reader compatible with this format.
Existing legacy records can keep absence unavailable until they leave the
retention window. With 32 slots per epoch, a bid for slot `s` is removed at
`s + 97`, about 19 minutes 24 seconds later on a 12-second network. All identity
journals must finish that pruning, and a new order must then be admitted after
the coverage boundary. This is not a timer guarantee: further unknown records
or lost coverage can keep absence unavailable. Retained positive evidence is
available immediately.

The reusable `test/perf/commitmentMetadata.mjs` benchmark compares the real BLS
signer and primary/shared journal worker acknowledgement path on one filesystem:

```sh
node packages/builder/test/perf/commitmentMetadata.mjs /path/to/compiled/repository 64 4 48
```

The arguments select the repository, order count (0, 64 or 256), blob count
(0 or 4), and revision count. Zero orders omits metadata to measure the legacy
input path. Use alternating baseline and candidate processes without concurrent
builds. Synthetic payloads measure durable preparation overhead, not execution
validity, remote delivery, payload value, or win rate.

## License

Apache-2.0 [ChainSafe Systems](https://chainsafe.io)
