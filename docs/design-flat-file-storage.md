# Design: Flat File Storage for Blobs and Data Columns

## Status

**Draft** | February 2026

## Summary

This document proposes migrating blob sidecars and data column sidecars from the single LevelDB instance to filesystem-based flat file storage. The design is inspired by Prysm's filesystem storage but adapted to Lodestar's TypeScript architecture and existing patterns.

The core insight: blobs and data columns are large, write-once, read-rarely, and expire after a retention window. These properties make them ideal candidates for flat file storage, where writes are O(1) (no LSM compaction), pruning is a directory delete, and the data can be stored in its native SSZ wire format with zero serialization overhead.

---

## 1. Proposed Filesystem Layout

### Directory Structure

```
<datadir>/
  beacon.db/                     # Existing LevelDB (blocks, states, op pool, indices)
  blob_sidecars/
    <slot>/
      0x<block_root>.ssz         # All blob sidecars for this block (BlobSidecarsWrapper SSZ)
  data_columns/
    <slot>/
      0x<block_root>.dcol        # All data columns for this block (custom binary format)
```

### Why Slot-Based Top-Level Directories

Compared to epoch-based (Prysm style) or root-based layouts:

| Approach     | Pruning                       | Lookup by slot          | Lookup by root | Dir fanout                       |
| ------------ | ----------------------------- | ----------------------- | -------------- | -------------------------------- |
| **By epoch** | Delete epoch dirs             | Compute epoch, scan dir | Need index     | ~225 files/dir at 32 slots/epoch |
| **By slot**  | Delete slot dirs below cutoff | Direct path             | Need index     | 1 file per slot dir              |
| **By root**  | Scan all dirs for expiry      | Need index              | Direct path    | Unbounded                        |

**Slot-based** is chosen because:

1. **Pruning is the critical path.** With 128 data columns per block, the volume of expired data is enormous. Slot-based layout enables `rm -rf slot_dir` for each expired slot with no scanning.
2. **Archive queries are slot-keyed.** The beacon API serves finalized blobs/columns by slot. Direct path construction: `data_columns/<slot>/0x<root>.dcol`.
3. **Bounded directory entries.** Each slot directory contains at most 1 file (canonical block). During the unfinalized window, a slot might have a few files from different forks, but fork count is small (typically 1-3).
4. **Natural ordering.** `readdir` + sort by directory name gives chronological order for iteration.

### Slot Directory Naming

Slot numbers are zero-padded to 12 digits for lexicographic sorting:

```
data_columns/000010000000/0xabcd...1234.dcol
data_columns/000010000001/0xabcd...5678.dcol
```

12 digits supports slots up to 999,999,999,999 (~9.5 million years at 12s slots).

### Alternative: Epoch Subdirectories for Pruning Efficiency

For faster bulk pruning, an optional epoch grouping layer can be added:

```
data_columns/
  epoch_000312500/            # epoch = slot / 32
    000010000000/
      0x<root>.dcol
    000010000001/
      0x<root>.dcol
```

This allows pruning an entire epoch with a single `rm -rf epoch_*` call, removing 32 slot directories at once. The trade-off is slightly deeper path nesting. **Recommendation: start with flat slot directories** and add epoch grouping only if pruning benchmarks show it's needed.

---

## 2. File Format Specification

### 2.1 Blob Sidecars (`.ssz`)

Blob sidecars use the existing `BlobSidecarsWrapper` SSZ encoding, which is already the format stored in LevelDB today:

```
[BlobSidecarsWrapper SSZ bytes]
```

Where `BlobSidecarsWrapper` is:

```typescript
{
  blockRoot: Root,       // 32 bytes
  slot: Slot,            // 8 bytes
  blobSidecars: BlobSidecars  // List[BlobSidecar, MAX_BLOBS_PER_BLOCK]
}
```

**Rationale:** No format change needed. The wrapper already bundles all blobs for a block into a single value. File size: ~786 KB with 6 blobs (current Deneb max), up to ~3.1 MB with 24 blobs (possible future increase).

### 2.2 Data Columns (`.dcol` - Custom Binary Format)

Data columns use a custom binary format with a fixed-size header for O(1) random column access, inspired by Prysm's `.sszs` format.

#### Format Layout

```
+------------------+-------------------+--------------------------------------------------+
| Header (149 B)   | Offset Table      | Compressed Column Data                           |
+------------------+-------------------+--------------------------------------------------+

Header (149 bytes):
  [version:     1 byte ]  0x01
  [_reserved:   4 bytes]  Zero-filled
  [bitmap:     16 bytes]  128-bit bitmap, bit i = 1 if column i is present
  [block_root: 32 bytes]  Block root for integrity verification
  [slot:        8 bytes]  Little-endian uint64 (matching SSZ convention), only low 4 bytes used
  [reserved:   88 bytes]  Zero-filled, for future use

Total header: 1 + 4 + 16 + 32 + 8 + 88 = 149 bytes

Offset table ((N+1) * 4 bytes, where N = popcount(bitmap)):
  [offset_0: 4 bytes BE]   Start of column 0's compressed data (relative to data region start)
  [offset_1: 4 bytes BE]   Start of column 1's compressed data
  ...
  [offset_N: 4 bytes BE]   End of last column = total data region size (sentinel)

Data region:
  [snappy(column_0_ssz)]  (if bitmap bit 0 is set)
  [snappy(column_1_ssz)]  (if bitmap bit 1 is set)
  ...
  [snappy(column_N_ssz)]  (if bitmap bit N is set)
```

Each column is independently Snappy block-compressed (not framed). This preserves O(1) random access while reducing disk usage significantly.

#### Key Design Decisions

**Per-column Snappy compression:** Each column is compressed independently, so reading a single column only requires decompressing that column's ~5-8 KB of compressed data rather than the entire file. Snappy block format (not framing) is used since column boundaries are explicit in the offset table.

**Offset table for random access:** Variable-size compressed columns cannot use fixed-stride seeking. The `(N+1)`-entry offset table (one uint32 per column plus a sentinel) enables O(1) seek: read `offsets[p]` and `offsets[p+1]` to get the byte range for bitmap position `p`.

**128-bit bitmap:** With `NUMBER_OF_COLUMNS = 128`, a 16-byte bitmap (128 bits) is sufficient. Bit `i` being set indicates column `i` is present in the file. This supports:

- Partial column storage (supernode with subset of columns)
- Incremental writes (receive columns over time, update bitmap)
- O(1) existence checks without reading column data

**Block root and slot in header:** Enables integrity checks and allows recovery/validation without external index.

**Reserved bytes:** The 88-byte reserved region allows future header extensions (e.g., checksum) without a format version bump.

**Snappy decompress returns fresh allocations:** This naturally avoids the `Buffer.slice()` RSS memory bloat issue where slicing views into a large file buffer would retain the entire backing ArrayBuffer.

#### Random Access Algorithm

To read column `i` from a `.dcol` file:

```
1. Read header (149 bytes)
2. Check bitmap bit i → if 0, column not present
3. p = popcount(bitmap, 0..i-1)    — position in the offset table
4. N = popcount(bitmap)             — total columns
5. dataStart = 149 + (N+1) * 4     — start of compressed data region
6. Read offsets[p] and offsets[p+1] from offset table at 149 + p*4
7. Compressed bytes = file[dataStart + offsets[p] : dataStart + offsets[p+1]]
8. Decompress with Snappy → DataColumnSidecar SSZ
```

#### Size Analysis

Per data column sidecar with 6 blobs (uncompressed):

- Column data: 6 cells x 2,048 bytes = 12,288 bytes
- KZG commitments: 6 x 48 = 288 bytes
- KZG proofs: 6 x 48 = 288 bytes
- Signed block header: ~200 bytes
- Inclusion proof: 128 bytes
- SSZ container overhead: ~50 bytes
- **Total per column: ~13.2 KB**

Per block with 128 columns (uncompressed): 128 x 13.2 KB + 149B header = **~1.69 MB**

Per block with 128 columns (Snappy compressed): offset table (516B) + compressed data ≈ **~0.85-1.1 MB** (estimated ~40-50% compression on SSZ column data with Snappy)

Per block with 6 blobs (pre-fulu, blob sidecars only): **~786 KB**

Daily data volume (at 7,200 slots/day, assuming all slots have 6 blobs):

- Data columns: 7,200 x ~1.0 MB ≈ **~7 GB/day** (down from ~11.9 GB/day uncompressed)
- Blob sidecars: 7,200 x 786 KB = **~5.5 GB/day**

With 18-day retention (`MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS` = 4096 epochs ≈ 18.2 days):

- Data columns: **~125 GB retained** (down from ~216 GB uncompressed)
- Blob sidecars: ~100 GB retained

### 2.3 Format Versioning

The version byte in the `.dcol` header supports future format evolution. The current (and only) version is `0x01`.

Blob sidecars use standard SSZ and don't need a custom version header.

---

## 3. Write Path

### 3.1 Atomic Writes (Crash Safety)

All file writes follow the temp-file + fsync + rename pattern:

```typescript
async function atomicWrite(targetPath: string, data: Uint8Array): Promise<void> {
  const tmpPath = targetPath + ".part";
  const fd = await fs.open(tmpPath, "w");
  try {
    await fd.write(data);
    await fd.datasync(); // fsync the data
    await fd.close();
    await fs.rename(tmpPath, targetPath); // atomic on same filesystem
  } catch (e) {
    await fd.close().catch(() => {});
    await fs.unlink(tmpPath).catch(() => {});
    throw e;
  }
}
```

**Why `datasync` instead of `fsync`:** `datasync` skips metadata updates (atime/mtime) and is sufficient for data integrity. The subsequent `rename` will update directory metadata.

**Why not O_TMPFILE:** While Linux supports anonymous temp files via `O_TMPFILE`, Node.js doesn't expose this flag natively. The `.part` suffix approach is portable and well-understood.

### 3.2 Hot Path: Gossip Reception → Filesystem

When blobs/columns arrive via gossip (before finalization), they go directly to the filesystem:

```
Gossip received → Validate → Write to filesystem → Update in-memory cache
```

This differs from the current approach where unfinalized data is written to LevelDB hot buckets and later migrated to archive buckets on finalization. With flat files:

1. **No hot/cold distinction for blobs and columns.** Files are written once to their final location. The slot and root are known at reception time.
2. **No re-keying migration.** Finalization only needs to delete non-canonical files, not move canonical ones.
3. **Fork handling.** Multiple files per slot directory handle forks naturally. On finalization, non-canonical files are deleted.

```typescript
// On blob/column reception (gossip or RPC)
async function onBlobSidecars(slot: Slot, blockRoot: Root, wrapper: BlobSidecarsWrapper): Promise<void> {
  const dir = path.join(this.blobsDir, padSlot(slot));
  await fs.mkdir(dir, {recursive: true});
  const filePath = path.join(dir, `0x${toRootHex(blockRoot)}.ssz`);
  await atomicWrite(filePath, blobSidecarsWrapperSsz.serialize(wrapper));
  this.existenceCache.setBlobPresent(slot, blockRoot);
}

// On data column reception (gossip or RPC)
async function onDataColumnSidecars(slot: Slot, blockRoot: Root, columns: DataColumnSidecar[]): Promise<void> {
  const dir = path.join(this.columnsDir, padSlot(slot));
  await fs.mkdir(dir, {recursive: true});
  const filePath = path.join(dir, `0x${toRootHex(blockRoot)}.dcol`);
  const existing = await this.readDcolHeader(filePath);
  const merged = existing ? mergeColumns(existing, columns) : packColumns(slot, blockRoot, columns);
  await atomicWrite(filePath, merged);
  this.existenceCache.setColumnsPresent(
    slot,
    blockRoot,
    columns.map((c) => c.index)
  );
}
```

### 3.3 Data Column Incremental Writes

Data columns may arrive incrementally (subset of 128 columns at a time). The `.dcol` format supports this:

1. **First write:** Create file with header + available columns, set bitmap bits.
2. **Subsequent writes:** Read existing file, merge new columns into the sorted position, update bitmap, atomic rewrite.

Merging decompresses existing columns, adds new ones, then re-encodes the full file:

- Read all existing columns via `readAllColumns()`
- Merge with new columns (add or overwrite by index)
- Re-encode: compress each column, build offset table, atomic write

**Concurrency:** Each store (`BlobStore`, `ColumnStore`) has an embedded per-root write lock using promise chaining. The lock is keyed by `${slot}:${rootHex}` and ensures that concurrent writes to the same file are serialized. The chain entry is cleaned up when the last writer releases, so there is no unbounded growth.

### 3.4 Wire Format Passthrough

A major optimization: gossip-received blobs and columns arrive as SSZ bytes on the wire. Currently Lodestar deserializes them to typed objects, then re-serializes for LevelDB storage. With flat files, the raw wire bytes can be written directly if they've been validated:

```typescript
// Instead of: serialize(deserialize(wireBytes))
// Just: write(wireBytes)
async function onValidatedColumnBytes(
  slot: Slot,
  blockRoot: Root,
  columnIndex: ColumnIndex,
  sszBytes: Uint8Array
): Promise<void> {
  // sszBytes is the validated SSZ wire bytes - write directly
  await this.appendColumnBytes(slot, blockRoot, columnIndex, sszBytes);
}
```

This eliminates the deserialize-serialize round-trip for the hot write path. Column data is only deserialized when actually needed for reconstruction or serving.

---

## 4. Read Path

### 4.1 Blob Sidecar Reads

```typescript
async function getBlobSidecars(slot: Slot, blockRoot: Root): Promise<BlobSidecarsWrapper | null> {
  // Check existence cache first
  if (!this.existenceCache.hasBlobPresent(slot, blockRoot)) {
    return null;
  }
  const filePath = path.join(this.blobsDir, padSlot(slot), `0x${toRootHex(blockRoot)}.ssz`);
  try {
    const data = await fs.readFile(filePath);
    return blobSidecarsWrapperSsz.deserialize(data);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
```

### 4.2 Data Column Random Access

`getColumnsBinary` uses targeted `fd.read()` with position offsets to read only the bytes it needs — never the entire file. The read sequence:

1. `pread` 149 bytes — header (bitmap, version)
2. `pread` up to 516 bytes — offset table
3. Per requested column: `pread` ~5-8 KB — compressed column data, then Snappy decompress

For a typical reqresp custody request (4 columns), total I/O is **~25-35 KB** vs ~1 MB for a full file read. `pread()` doesn't mutate file descriptor state, so concurrent reads on the same file are safe without locking.

### 4.3 Bulk Reads (All Columns for Same Block)

When all columns are needed (merge, full deserialization), a single `readFile` + `readAllColumns` is used instead — one sequential read is more efficient than 128 individual seeks.

---

## 5. In-Memory Existence Cache

### Purpose

Avoid filesystem `stat()` or `open()` calls for non-existent data. With 128 columns per block and frequent DA sampling, the cache prevents thousands of unnecessary syscalls per second.

### Data Structure

```typescript
class ExistenceCache {
  // Blob existence: slot → Set<rootHex>
  private blobPresence = new Map<Slot, Set<RootHex>>();

  // Column existence: slot → Map<rootHex, bigint>
  // bigint stores a 128-bit bitmap (1n << index for each present column)
  private columnBitmaps = new Map<Slot, Map<RootHex, bigint>>();
}
```

The cache also provides `getAnyRootForSlot(slot)` which resolves slot → root from data it already tracks. For finalized slots there is exactly one canonical root per slot, so this replaces a separate slot-root index for by-slot lookups in reqresp handlers.

### Memory Usage

Per slot with one canonical block:

- Blob entry: ~80 bytes (RootHex string in Set)
- Column entry: ~96 bytes (RootHex string + bigint bitmap)

For 18-day retention window (~130,000 slots):

- Blobs: 130,000 x 80 = **~10 MB**
- Columns: 130,000 x 96 = **~12 MB**
- **Total: ~22 MB** (negligible)

### Cache Lifecycle

1. **Startup:** `rebuildFromDisk()` walks the blob and column directories, reading only `.dcol` headers (149 bytes each) to extract bitmaps. `.part` files are ignored.
2. **Runtime:** Updated on every write and delete.
3. **Pruning:** `evictBelow(minSlot)` batch-evicts entries for pruned slots.

### Warm-up Optimization (Future)

Currently the cache is rebuilt from disk on every startup by walking all slot directories. For large retention windows (~130,000 slots), this could take 10-30 seconds. A future optimization would persist the cache to a compact binary file on graceful shutdown and load it on startup, only scanning slots newer than the persisted max slot.

---

## 6. Pruning

### Pruning Algorithm

```typescript
async function pruneExpiredData(currentEpoch: Epoch): Promise<void> {
  const blobCutoffSlot = computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS);
  const columnCutoffSlot = computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS);

  // Prune blobs
  await pruneDirectoriesBelowSlot(this.blobsDir, blobCutoffSlot);

  // Prune columns
  await pruneDirectoriesBelowSlot(this.columnsDir, columnCutoffSlot);

  // Evict cache entries
  this.existenceCache.evictBelow(Math.min(blobCutoffSlot, columnCutoffSlot));
}

async function pruneDirectoriesBelowSlot(baseDir: string, cutoffSlot: Slot): Promise<void> {
  const entries = await fs.readdir(baseDir);
  const prunePromises: Promise<void>[] = [];

  for (const entry of entries) {
    const slot = parseInt(entry, 10);
    if (Number.isNaN(slot) || slot >= cutoffSlot) continue;
    prunePromises.push(fs.rm(path.join(baseDir, entry), {recursive: true, force: true}));
  }

  // Prune in parallel batches to avoid overwhelming the filesystem
  const BATCH_SIZE = 1000;
  for (let i = 0; i < prunePromises.length; i += BATCH_SIZE) {
    await Promise.all(prunePromises.slice(i, i + BATCH_SIZE));
  }
}
```

### Pruning Performance

**Current (LevelDB):** Deleting expired blobs/columns requires:

1. Key scan to find expired entries
2. Individual key deletions in LevelDB
3. LSM compaction to actually reclaim space (happens asynchronously, I/O intensive)

**Proposed (filesystem):** Deleting expired blobs/columns requires:

1. `readdir` to list slot directories
2. `rm -rf` for each expired slot directory
3. Space is reclaimed immediately by the filesystem

Expected improvement: **10-100x faster pruning** for large datasets. LevelDB compaction for 10+ GB of deleted data can take minutes; filesystem `unlink` is near-instant per file.

### Pruning During Finalization

On each finalized checkpoint, the archiving pipeline runs:

```
1. Delete non-canonical blob/column files for newly finalized slots
2. Prune expired data (slots older than retention window)
3. Evict write locks for finalized slots
```

Step 1 replaces the current "delete non-canonical blocks from hot" LevelDB operation. Step 2 replaces the current `blobSidecarsArchive.batchDelete` and `dataColumnSidecarArchive.deleteMany` operations.

---

## 7. Migration Path from LevelDB

### Phase 1a: New Data to Filesystem (Feature Flag)

Add a `--chain.flatFileStorage` CLI flag (default: `true`).

When enabled:

- Blob sidecars and data columns are written to the filesystem
- Reads go to filesystem (with LevelDB fallback for data written before the flag was enabled)
- Pruning operates on the filesystem

This allows easy rollback by disabling the flag.

### Phase 1b: Background Migration of Existing Data

A background migration task runs at low priority after startup:

```typescript
async function migrateExistingData(): Promise<void> {
  // Migrate archived blob sidecars
  for await (const entry of db.blobSidecarsArchive.entriesStream()) {
    const slot = entry.key;
    const wrapper = entry.value;
    await flatStore.writeBlobSidecars(slot, wrapper.blockRoot, wrapper);
  }

  // Migrate archived data columns
  for await (const entry of db.dataColumnSidecarArchive.entriesStreamBinary()) {
    await flatStore.writeColumnBytes(entry.prefix, entry.id, entry.value);
  }

  // Migrate hot blob sidecars
  for await (const entry of db.blobSidecars.entriesStream()) {
    const wrapper = entry.value;
    await flatStore.writeBlobSidecars(wrapper.slot, wrapper.blockRoot, wrapper);
  }

  // Migrate hot data columns
  for await (const entry of db.dataColumnSidecar.entriesStreamBinary()) {
    await flatStore.writeColumnBytes(...);
  }
}
```

The migration can be interrupted and resumed (check existence before writing).

### Phase 1c: Remove LevelDB Blob/Column Storage

Once migration is verified:

1. Remove the `--flatFileStorage` flag, make it the default
2. Remove `BlobSidecarsRepository`, `BlobSidecarsArchiveRepository`, `DataColumnSidecarRepository`, `DataColumnSidecarArchiveRepository`
3. Remove bucket IDs 27, 28, 57, 58
4. Add a one-time startup task to clean up remaining LevelDB blob/column data

### Phase 2: Separate DB for Blocks (Future)

Following Lighthouse's approach, blocks could stay in a KV store but in a separate instance:

- Main DB: fork choice state, op pool, indices, light client data
- Block DB: finalized + unfinalized blocks
- Filesystem: blobs and data columns

This is a lower priority since blocks are smaller and benefit more from KV store features (range queries, indices).

---

## 8. API Changes to IBeaconDb

### New Interface: `IFlatFileStore`

```typescript
interface IFlatFileStore {
  init(): Promise<void>;
  close(): Promise<void>;

  // Blob sidecars
  getBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<BlobSidecarsWrapper | null>;
  getBlobSidecarsBinary(slot: Slot, blockRoot: RootHex): Promise<Uint8Array | null>;
  getBlobSidecarsBinaryBySlot(slot: Slot): Promise<Uint8Array | null>;
  putBlobSidecars(slot: Slot, blockRoot: RootHex, data: Uint8Array): Promise<void>;
  deleteBlobSidecars(slot: Slot, blockRoot: RootHex): Promise<void>;
  hasBlobSidecars(slot: Slot, blockRoot: RootHex): boolean; // sync, from cache
  blobSidecarsBinaryEntriesStream(opts: {gte: Slot; lt: Slot}): AsyncIterable<{slot: Slot; data: Uint8Array}>;

  // Data columns
  getDataColumns(slot: Slot, blockRoot: RootHex): Promise<DataColumnSidecar[]>;
  getDataColumnsBinary(slot: Slot, blockRoot: RootHex, indices: number[]): Promise<(Uint8Array | undefined)[]>;
  getDataColumnsBinaryBySlot(slot: Slot, indices: number[]): Promise<(Uint8Array | undefined)[]>;
  putDataColumnsBinary(slot: Slot, blockRoot: RootHex, columns: {index: number; data: Uint8Array}[]): Promise<void>;
  putDataColumns(slot: Slot, blockRoot: RootHex, columns: DataColumnSidecar[]): Promise<void>;
  deleteDataColumns(slot: Slot, blockRoot: RootHex): Promise<void>;
  hasDataColumn(slot: Slot, blockRoot: RootHex, index: number): boolean; // sync, from cache
  getColumnBitmap(slot: Slot, blockRoot: RootHex): bigint | null; // sync, from cache

  // Pruning
  deleteNonCanonical(items: {slot: Slot; blockRoot: RootHex}[]): Promise<void>;
  pruneBlobsBeforeSlot(slot: Slot): Promise<void>;
  pruneColumnsBeforeSlot(slot: Slot): Promise<void>;
  pruneHotBlobs(): Promise<void>; // no-op for flat files (no hot/cold distinction)
}
```

Key differences from the original proposal:

- All methods take `RootHex` (hex string) instead of `Root` (Uint8Array), matching Lodestar's fork choice conventions
- By-slot lookups (`getBlobSidecarsBinaryBySlot`, `getDataColumnsBinaryBySlot`) for finalized reqresp handlers that only know the slot
- Separate `pruneBlobsBeforeSlot`/`pruneColumnsBeforeSlot` (blobs and columns may have different retention windows)
- `deleteNonCanonical` for batch cleanup of orphaned blocks on finalization
- `blobSidecarsBinaryEntriesStream` for the `blobSidecarsByRange` reqresp handler

### Changes to IBeaconDb

```typescript
export interface IBeaconDb {
  // ... existing fields ...

  // Flat file store for blobs and columns (null when --chain.flatFileStorage is disabled)
  flatFileStore: IFlatFileStore | null;
  initFlatFileStore?(dataDir: string, logger: Logger): Promise<void>;

  // Coexists with flat file store during transition (Phase 1c: removed)
  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;
}
```

Callers check `if (db.flatFileStore)` before using flat file APIs, falling back to the LevelDB repositories otherwise.

### Changes to Archive Pipeline

The `archiveBlocks` function in `archiveStore/utils/archiveBlocks.ts` simplifies significantly:

**Before (LevelDB):**

1. Read blob/column from hot bucket (by root)
2. Write to archive bucket (by slot) - re-keying
3. Delete from hot bucket
4. Scan archive for expired entries
5. Batch delete expired entries

**After (flat files):**

1. Delete non-canonical files for finalized slots
2. Delete expired slot directories

No migration step needed - data is already in its final location.

---

## 9. Performance Analysis

### Write Amplification

| Operation                     | LevelDB (current)                                | Flat File (proposed)        |
| ----------------------------- | ------------------------------------------------ | --------------------------- |
| Initial write                 | 1x write + LSM compaction (10-30x over lifetime) | 1x write + fsync            |
| Hot→cold migration            | 1x read + 1x write + 1x delete + compaction      | Not needed                  |
| Pruning                       | 1x delete + compaction to reclaim space          | 1x unlink (instant reclaim) |
| **Total write amplification** | **~15-50x**                                      | **~1x**                     |

### Disk Usage

|                   | LevelDB                                         | Flat File                                                       |
| ----------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| Storage overhead  | ~1.1-1.5x (SSZ + LevelDB metadata + LSM levels) | ~0.5-0.65x (Snappy-compressed SSZ + offset table + 149B header) |
| Post-delete bloat | Significant until compaction                    | None (unlink reclaims immediately)                              |
| Fragmentation     | Internal (LSM levels)                           | Filesystem-level (minimal with modern ext4/xfs)                 |

### Read Latency

| Operation                    | LevelDB                            | Flat File                                                                      |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ |
| Single blob lookup           | ~0.5-2ms (key lookup + decompress) | ~0.1-0.5ms (open + read, cached by OS)                                         |
| Single column lookup         | ~0.5-2ms (key lookup + decompress) | ~0.1-0.3ms (open + header pread + column pread + snappy decompress)            |
| Existence check              | ~0.3-1ms (key lookup)              | **~0ns** (in-memory cache)                                                     |
| Batch column lookup (4 cols) | ~2-8ms (4 key lookups)             | ~0.2-0.5ms (open + header pread + table pread + 4 column preads, ~30 KB total) |
| All columns for block        | ~5-15ms (128 key lookups)          | ~1-3ms (single file read + 128 snappy decompress)                              |

### Throughput (Sustained Writes)

|                                   | LevelDB                               | Flat File                            |
| --------------------------------- | ------------------------------------- | ------------------------------------ |
| 128 columns/block at 12s interval | Bottleneck: LSM compaction contention | 128 sequential writes, no contention |
| Concurrent block processing       | Single LevelDB lock                   | Independent files, full parallelism  |

### Pruning Speed

|                                          | LevelDB                                      | Flat File               |
| ---------------------------------------- | -------------------------------------------- | ----------------------- |
| Prune 1 epoch (32 slots, ~54 MB columns) | 10-30 seconds (scan + delete + compact)      | <1 second (32 x rm -rf) |
| Prune 1 day (225 epochs, ~12 GB columns) | Minutes (heavy I/O, blocks other operations) | ~5-10 seconds           |

---

## 10. Implementation Plan

### Module Structure

```
packages/beacon-node/src/db/
  flatFileStore/
    index.ts                    # Exports
    interface.ts                # IFlatFileStore interface definition
    flatFileStore.ts            # Main FlatFileStore class implementing IFlatFileStore
    blobStore.ts                # Blob sidecar file operations
    columnStore.ts              # Data column file operations
    dcolFormat.ts               # .dcol binary format encode/decode
    existenceCache.ts           # In-memory existence bitmap cache
    atomicWrite.ts              # Atomic write utility
```

### Implementation Order

1. **`atomicWrite.ts`** - Atomic file write utility
2. **`dcolFormat.ts`** - .dcol format encode/decode/merge
3. **`existenceCache.ts`** - Bitmap-based existence cache
4. **`blobStore.ts`** - Blob sidecar read/write/prune
5. **`columnStore.ts`** - Data column read/write/prune with locking
6. **`flatFileStore.ts`** - Unified store coordinating blob + column stores
7. **Integration** - Wire into `BeaconDb`, update archive pipeline
8. **Migration** - Background LevelDB→filesystem migration
9. **Cleanup** - Remove LevelDB blob/column repositories

### Testing Strategy

- **Unit tests:** Format encode/decode, existence cache, atomic writes
- **Integration tests:** Write/read/prune lifecycle, crash recovery (kill during write)
- **Performance benchmarks:** Write throughput, read latency, pruning speed vs LevelDB
- **Spec tests:** Ensure all blob/column-related spec tests pass with flat file backend

---

## 11. Risks and Mitigations

### Risk: Filesystem Inode Exhaustion

**Issue:** With 130,000+ slot directories and one file each, inode usage grows.

**Mitigation:** Modern filesystems (ext4, xfs) default to millions of inodes. At ~260,000 total inodes (130K blobs + 130K columns), this is well within limits. Monitor `df -i` in production.

### Risk: Directory Entry Scalability

**Issue:** A parent directory (`blob_sidecars/`) with 130,000+ entries could slow down `readdir` and `lookup`.

**Mitigation:**

- ext4 with `dir_index` (default since 2005) uses htree for O(1) lookup even with millions of entries
- xfs handles large directories natively
- If needed, add epoch-level grouping (reduces entries per directory to ~32)

### Risk: Incomplete Writes on Crash

**Issue:** Power failure during atomic write could leave `.part` files.

**Mitigation:**

- On startup, scan for and delete `.part` files
- The rename-based atomic write ensures that a complete file is either fully present or absent
- The existence cache is rebuilt from actual files, ignoring `.part` files

### Risk: Clock Skew / Slot Reorgs

**Issue:** In rare deep reorgs, a slot directory might contain files from multiple competing blocks.

**Mitigation:**

- Already handled: each file is named by block root, so multiple files per slot coexist
- On finalization, non-canonical files are deleted
- The existence cache tracks per-root presence

### Risk: Performance Regression Under Heavy Load

**Issue:** Filesystem I/O might be slower than LevelDB's batch operations under high contention.

**Mitigation:**

- The feature flag allows instant rollback to LevelDB
- Write batching: group column writes for the same block into a single file write
- OS page cache handles read caching automatically (no need for application-level read cache)

### Risk: Data Corruption

**Issue:** Bit rot or filesystem corruption could silently corrupt stored data.

**Mitigation:**

- SSZ deserialization will fail on corrupted data (natural integrity check)
- Optional: add a CRC32 checksum to the `.dcol` reserved header bytes in a future version
- Block root in the `.dcol` header enables cross-validation

### Rollback Strategy

1. **Phase 1a (dual-write):** Disable `--flatFileStorage` flag, restart. All data is in both LevelDB and filesystem.
2. **Phase 1b (post-migration):** Re-enable LevelDB writes, data is still in LevelDB.
3. **Phase 1c (LevelDB removed):** Cannot rollback without re-migration. This phase should only be entered after extended production validation.

---

## 12. Open Questions

1. **Should blob sidecars also use a custom binary format?** The current BlobSidecarsWrapper SSZ works but doesn't support random access to individual blob sidecars within the wrapper. If per-blob access becomes a requirement, a format similar to `.dcol` could be introduced.

2. **Should we use `O_DIRECT` for writes?** Bypassing the OS page cache could reduce memory pressure for write-once data. However, `O_DIRECT` requires aligned buffers and is not portable. Recommendation: start without it, benchmark, add if needed.

3. **~~Should we support compression?~~** Resolved: the `.dcol` format uses per-column Snappy block compression with an offset table, preserving O(1) random access. Snappy was chosen for its low CPU overhead and compatibility with the existing reqresp stack. Compression reduces column file sizes by ~40-50%.

4. **Should the existence cache be shared or per-store?** A single cache for both blobs and columns simplifies management. Recommendation: single `ExistenceCache` instance in `FlatFileStore`.

5. **What happens during backfill sync?** Backfilling historical data should write directly to flat files in the same format. The `updateBackfillRange` logic in `archiveStore` needs to be updated to interact with `IFlatFileStore`.
