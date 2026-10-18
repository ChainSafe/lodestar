# LevelDB storage

`@lodestar/native/leveldb` exposes asynchronous binary storage backed by
Google LevelDB through the Zig module in `src/leveldb`. It uses the same native
addon as the consensus bindings. The public JavaScript import remains
`@lodestar/native/leveldb`.

```js
import {LevelDb} from "@lodestar/native/leveldb";

const db = await LevelDb.open("./beacon-db");
try {
  const key = new Uint8Array([1, 2, 3]);
  await db.put(key, new Uint8Array([4, 5]), {sync: true});
  const value = await db.get(key);

  for await (const {key, value} of db.iterator({
    gte: new Uint8Array([1]),
    lt: new Uint8Array([2]),
  })) {
    console.log(key, value);
  }
} finally {
  await db.close();
}
```

Keys and values are `Uint8Array` instances, including Node.js `Buffer`. Missing
keys return `null`; empty stored values return an empty buffer. Inputs are copied
before the operation is queued, so callers may reuse their buffers immediately.
Results are ordinary `Uint8Array` instances and own their bytes. Shared or detached
input buffers are rejected.

## Workload and limits

Point reads use LevelDB's `Get` path. `getMany(keys)` holds one snapshot
for up to 16,777,216 keys, preserves input order and duplicates, and returns a
consistent view. The engine and C API materialize one complete stored value
before the binding checks its length and copies it into a bounded owned result.
The write side limits new values to 1 GiB; imported databases may contain larger
values, which reads reject after that temporary allocation. Reads and cursors
expose `fillCache`. Point reads default to filling the cache; native cursors default
to bypassing it. The Lodestar controller preserves its existing cache defaults.

`batch(operations, {sync})` applies an atomic ordered batch of puts and deletes.
Every operation and the aggregate payload are checked before constructing the
native write batch. Operations have the form `{type: "put", key, value}` or
`{type: "del", key}`. `sync: true` requests LevelDB's synchronous write policy.

| Resource | Limit |
| --- | --- |
| Key | 4 KiB |
| Individual value | 1 GiB |
| Atomic write batch | 16,777,216 operations and 4 GiB of keys plus values |
| Multi-get | 16,777,216 keys; 1 GiB aggregate result limit |
| Cursor refill | First pull: 1 row; later: up to 1,000, with a fixed soft 16 KiB watermark |
| Explicit cursor batch | Up to 16,777,216 entries; same watermark and 1 GiB hard selected key-plus-value byte limit |
| Diagnostic property copy | 1 MiB |
| Live cursors per database | 64 |
| Admitted operations per database | 4,096 by default, configurable up to 65,536 |
| Admitted copied input and job metadata per database | 8 GiB by default, configurable up to 16 GiB |

Configure admission with `maxPendingOperations` and `maxPendingBytes` at open.
These are finite operating limits, not consensus maxima. A request must fit its
payload and metadata budget; batches are never split into separate commits.
Queue saturation rejects before copying payloads. Read results allocate their
actual sizes on the worker after checking the fixed output bounds, rather than
allocating each read's maximum in advance. Each handle can retain two point/multi-get
results and one cursor/maintenance result until JavaScript delivery. Each result has
its own output bound, separate from queued input admission. Engine memory,
write-batch backing and JavaScript results retained by callers are outside this
accounting. An archive state therefore uses one ordinary value without a special
controller-side encoding or chunking scheme.

Each handle runs up to two `get`/`getMany` jobs concurrently on Node's worker pool,
alongside one serialized queue for writes, cursors and maintenance. Await writes
before issuing reads that must observe them. Reads can complete out of order;
each multi-get still observes one consistent view. Iterator creation remains
ordered with writes, so its snapshot includes preceding writes and excludes later
ones on that handle. Handles opened
with `multithreading: true` share the engine and cache while retaining independent
queues and admission limits; their jobs may execute concurrently. Closing stops
that handle's admissions, drains its accepted operations and retires its cursors.
The last handle releases the engine, cache and directory lock. Environment teardown
retains ownership until active work finishes. Applications should close handles
explicitly. The 64-cursor limit applies across handles sharing one database.

Cursors use a stable snapshot, `gt`/`gte` and `lt`/`lte` bounds, `reverse`, and an
optional total row `limit`. Inclusive bounds take precedence when both forms are
provided. `keys()` and `values()` project inside the native iterator, so a key-only
scan never copies stored values. The first `next()` and the first `next()` after
`seek(target)` read one row; later refills read up to 1000 rows.
Pages have a fixed soft watermark of 16 KiB of projected bytes.
A batch includes the row that takes it above the watermark, including a single
oversized row, and then stops. Equality does not stop a batch. Discarded projection
components do not count. `nextv(size)` returns up to the requested number, draining
an existing cache first without combining it with another native read; explicit
bulk requests can exceed the ordinary refill size.

Read results and cursor pages have a fixed 1 GiB hard limit. A row that fits an
empty page but not its remaining space stays pending for the next page. A row
exceeding the whole-page limit fails the iteration; partial results of a failing
read are freed, and no row is silently skipped.

`seek(target)` discards prefetched rows and repositions within the original
snapshot and bounds, in the iterator's direction. Out-of-range targets end the
iteration rather than clamp to a boundary. Seeking preserves the consumed limit,
including prefetched rows, matching classic-level. Targets are copied at the call;
only the latest target is retained, and the next pull positions before reading. Natural exhaustion of manual
`next()`/`nextv()` calls retains the cursor so seek can reuse its snapshot. Close
manual iterators when finished. `for await`, `return()`, explicit close, read
errors and database close release their cursors, including cancellation while
opening, seeking or reading. Only one pull may be pending; seek during a pull
rejects with `IteratorBusy`.

These limits bound application result materialization and admission. They do
**not** bound LevelDB's internal block reads, decompression, compaction, snapshot
retention, total RSS, or storage latency. Open only trusted local database
files, and bound the number of databases at the host. The cache defaults to
8 MiB and the write buffer to 4 MiB; neither is a whole-engine memory cap.

## Lodestar integration

Lodestar's database controller and peer datastore use this binding instead of
`classic-level` and `datastore-level`. The controller preserves missing-value,
range, cache, batch, metrics and lifecycle behavior. The binding supplies
`clear`, `approximateSize`, `compactRange`, `getProperty` and `destroy` directly;
maintenance runs on the calling handle's serialized queue alongside writes and cursors.
`clear` uses bounded deletion chunks and is not atomic across those chunks.

The controller opts into `multithreading`, preserving same-directory access from
its historical-state worker. Every sharing handle must opt in; engine options
come from the first opener. The binding resolves directory paths before sharing
or refusing an exclusive open, and rejects destruction while a handle remains open.
The host must still prevent concurrent access through independent engine copies
or filesystem aliases not resolved by `realpath`: POSIX process-scoped locks do
not reliably enforce that requirement. Existing databases keep their binary key
and value encodings. Lodestar forwards `fillCache` to native reads; the binding
owns the read-output limits and cursor batching policy.

Storage bounds do not certify a block's consensus validity, canonicality,
execution status, or provenance. Those checks remain with Lodestar. Returned-value
bounds do not bound LevelDB's engine workspace.

## Zig use and validation

`src/leveldb/root.zig` exports the bounded API. Zig callers use `getManyOwned`
and `Cursor.readOwned` for exact-sized allocated results, and `writeWithLimits`
for atomic writes with explicit byte and entry limits. `Cursor.readOwned` accepts
a soft watermark and keeps exhausted cursors seekable until explicit close. Callers
free each owned result with the database allocator. Database operations may run
concurrently with a thread-safe allocator; each cursor requires serialized access.
Callers keep the database address stable and retire all operations and cursors
before closing it. Each cursor uses its iterator's consistent view; it does not
need a separate engine snapshot. No iterator-owned pointer escapes into a returned result.

Engine-fallible operations accept an optional `Diagnostics` output. Each operation
owns its diagnostic message until `deinit`; do not share it between concurrent
operations. The binding carries that message to JavaScript's `Error.message` and
keeps the stable error category in `Error.code`.

The sibling suites are `src/leveldb/root_test.zig` for database operations,
`src/leveldb/cursor_test.zig` for cursor traversal and ownership, and
`src/leveldb/raw_test.zig` for raw handles. Run validation from the repository
root:

```sh
zig build test:leveldb
zig build test:leveldb -Doptimize=ReleaseSafe
zig build build-lib:bindings -Doptimize=ReleaseSafe -Dpreset=mainnet -Dtarget=x86_64-linux-gnu.2.35 -Dcpu=znver1
pnpm --filter @lodestar/native check-types
NODE_OPTIONS=--expose-gc pnpm exec vitest run bindings/test/leveldb*.test.ts
```

## Native dependencies and attribution

The root `build.zig.zon` pins the `leveldb_c` dependency to
[ChainSafe/leveldb.zig commit e44b7544178a7fdcf12f41e15b5d043cf2ac3be9](https://github.com/ChainSafe/leveldb.zig/tree/e44b7544178a7fdcf12f41e15b5d043cf2ac3be9)
from the `chore/zig-0.16` branch. The local `leveldb` module's
`.link_libraries = .{"leveldb_c:leveldb"}` consumes only the upstream C library
artifact. `src/leveldb/raw.zig` uses `@cImport` for the C API; the upstream Zig
wrapper is not imported. Lodestar-z owns the bounded API in `src/leveldb/root.zig`.
There is no separate package manifest.

The root `build.zig` uses public build APIs to enable position-independent code
for LevelDB and Snappy so they can link into the Node addon. It also defines
`HAVE_O_CLOEXEC` on non-Windows targets to correct the pinned upstream build's
macro spelling and keep database descriptors out of child processes. The upstream
and root Snappy dependencies use commit
`713942410426051da6107a955b29f3f152815622` with the same content hash. These root
build settings allow consumption of the published artifact on Zig 0.16 without
an upstream patch.

The raw handles in `src/leveldb/raw.zig` are adapted
from [ChainSafe/leveldb.zig revision 186c4ddb4d4569a54103cd00749ca5d81623d6aa](https://github.com/ChainSafe/leveldb.zig/tree/186c4ddb4d4569a54103cd00749ca5d81623d6aa).
Lodestar-z maintains these adaptations for Zig 0.16. The original ChainSafe MIT
license is retained in [src/leveldb/LICENSE](../../src/leveldb/LICENSE). Google LevelDB
and Snappy retain their own licenses.

## Raw handle ownership

`src/leveldb/raw.zig` exposes low-level handles for the Google LevelDB C API.
`Options.create`, `ReadOptions.create`, `WriteOptions.create`, `WriteBatch.create`,
`Cache.createLru`, `DB.createIterator`, and `DB.createSnapshot` return error unions;
callers must handle `OutOfMemory` when the C API returns a null handle. C++ allocation
failures inside LevelDB or Snappy can still terminate the process.

Core method names follow ChainSafe's wrapper, including `Options.setCache`,
`Options.setParanoidChecks`, `ReadOptions.setVerifyChecksums`,
`ReadOptions.setSnapshot`, `WriteOptions.setSync`, `Iterator.getError`, and
`DB.releaseSnapshot`. The adaptation omits custom comparator, filter policy,
environment, logger, batch callback, and repair wrappers.

`DB.get` checks and frees the C error before interpreting a null result as a missing
key. Successful results are C-owned and require the raw module's `free(value.ptr)`,
including empty values. `DB.propertyValue` results require the same cleanup.
`DB.get` allocates the complete value; `getManyOwned` checks that value's length
before allocating its owned copy and frees the C allocation on success or failure.

Iterator `key()` and `value()` return borrowed bytes valid only until that iterator
moves or is destroyed. Inspect lengths and copy into caller-owned memory before
advancing. Never pass these borrowed slices directly to JavaScript or retain them
across asynchronous work. `next`, `prev`, `key`, and `value` require a valid iterator.
Always check `getError` after positioning or traversal; an invalid iterator can
indicate an I/O or corruption error instead of the end of the range.

A snapshot belongs to its creating database. Keep it alive while reads or iterators
use it. Destroy iterators and release snapshots before closing their database.
A configured cache must outlive all databases that use it. Handles have one owner;
close, destroy, or release each exactly once. Callers serialize use of mutable
handles and enforce input sizes, batch limits, and traversal budgets before entering
the raw API. Cache capacity and read output limits do not bound engine scratch
space or process RSS.

## Workload measurements

`bindings/perf/leveldb.ts` measures the installed addon without changing production defaults:

```sh
node --import tsx bindings/perf/leveldb.ts > /tmp/leveldb-defaults.json
node --import tsx bindings/perf/leveldb.ts --archive-mib=300 --rounds=32 > /tmp/leveldb-large-state.json
node --import tsx bindings/perf/leveldb.ts --offline-sample=/path/to/offline-snapshot --start-hex=0010 --work-dir=/scratch > /tmp/leveldb-sample.json
node --import tsx bindings/perf/leveldb.ts --cache-mib=64 --write-buffer-mib=32 --open-files=2000 > /tmp/leveldb-options.json
```

Only supply a closed database or a consistent filesystem snapshot. The benchmark
never opens the source directory: it copies the flat snapshot into a fresh temporary
directory for each case and removes its copies afterwards. Samples are capped at
8 GiB and 100,000 files. Without a sample it creates 256 deterministic 64 KiB rows;
the report labels this as a synthetic smoke run, not mainnet evidence.

Both cases use the same first 128 keys at or after `start-hex`. Choose a prefix from
the database's block or column archive; this is a bounded range replay, not uniform
sampling of the whole database. Each round reads a point hit, a known miss and a
cursor seek plus page while writing a 128 KiB record. `range_page` includes both
the deferred native seek and the following page read. Every eighth round also reads a synthetic
archived state. The second case submits an archive write before the reads every eight
rounds, on the same handle. Archive bytes are deterministic and incompressible, and
writes use the ordinary asynchronous durability policy. The archive defaults to
32 MiB, accepts 1–512 MiB, and total archive writes per case are capped at 8 GiB.
The cursor retains its snapshot throughout each case, as a serving iterator does.

JSON output includes operation counts and p50/p95/p99/max latency in milliseconds,
synchronous submission time separately, `leveldb.stats` before and after each case,
options, Node version, commit and local addon SHA-256. Submission time captures input
copying before the promise returns. Read latency starts at that read's invocation,
so it excludes an earlier archive write's synchronous submission stall. RSS is a
point observation; peak RSS is cumulative across both cases in the same process.

Run repeated comparisons on the same snapshot and filesystem before changing a
default. The harness does not flush the OS page cache, model production arrival
rates, or infer significance from a small sample. Compare unchanged-addon repeats
before interpreting a rebuilt addon's numbers. `max_file_size` is not configurable
through the binding, so this harness does not claim to compare table sizes.
