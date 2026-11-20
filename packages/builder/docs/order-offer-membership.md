# Per-offer order membership

An execution block hash identifies immutable payload bytes. It does not identify
the searcher authorization that supplied those bytes. Two owners can submit the
same transactions, and cancellation can leave only the second owner authorized.

`PayloadStore.add()` retains one physical body and returns an offer wrapper with
copied, frozen order metadata. It validates body equality before sharing an
existing hash. `Bidder` passes that wrapper explicitly to `BidPublisher.prepare()`
and durable retention. Asynchronous writes never look up new attribution by hash.
Production publishers require that explicit offer context before signing; a missing
context fails closed. The first stored wrapper is not overwritten, and order IDs
are never unioned. Staged bids copy membership from the selected primary admission,
not the first body stored under its block hash. `BidStore` caches that current
admission membership separately; only immutable journal records establish past
exposure.

The payload and blob journal files remain immutable. Every signed bid's exposure
record carries its own membership and first possible-exposure timestamp. When
identical signed bytes are authorized with different metadata, a separate v3 bid
admission is written under SHA-256 of a domain prefix, signed bid root and
canonical metadata. The original v1/v2 bid record remains byte-identical. Retries
of the same admission are idempotent. The bid ledger still records one signature;
separate admissions do not duplicate its financial liability. Exposure counts
refer to admissions, which can share a signed root. A publisher bounds preparations
at 256 per slot even for repeated signed bytes, and the journal separately bounds
distinct durable admissions at 256 per slot across restarts. Exact journal retries
remain idempotent; a recovered journal at its cap rejects a new admission before
exposure, even if the caller has already computed its signature. The cap check
runs before payload/blob writes or reference links. Its definite refusal keeps
async exposure health intact, and following slots remain usable.

Recovery reads legacy bare signed records and v2 records, and validates v3 record
names against their exact membership. Unknown future versions are rejected.
Legacy or unknown membership never proves absence. Older binaries cannot recover
v3 admissions and fail closed, so rollback must retain a reader with v3 support
until those historical records expire. Do not delete journals to permit rollback.

Staged identities can hard-link the same payload bytes while journaling distinct
membership. A durable body reference is rebound only by creating a new wrapper;
its original metadata and physical files are unchanged. Before first admission,
`doNotOfferBefore` still applies even when that hash is already stored.

Cancellation revokes one owner's order authorization, not transaction bytes.
Identical transactions can land independently from the public mempool or another
owner's authorized order. Receipts report that owner's possible exposure; they
do not promise transaction-byte exclusion or revoke earlier signed offers.

This is attribution correctness, not individual order revocation. Existing
constructor generations, 250 ms offer leases, cancellation drain, admission caps
and prior signed-payload reveal obligations are unchanged. The scoped constructor
experiment remains opt-in. No deployment or high-throughput readiness is implied.
