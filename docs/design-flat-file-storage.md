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

| Approach | Pruning | Lookup by slot | Lookup by root | Dir fanout |
|----------|---------|----------------|----------------|------------|
| **By epoch** | Delete epoch dirs | Compute epoch, scan dir | Need index | ~225 files/dir at 32 slots/epoch |
| **By slot** | Delete slot dirs below cutoff | Direct path | Need index | 1 file per slot dir |
| **By root** | Scan all dirs for expiry | Need index | Direct path | Unbounded |

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
+------------------+--------------------------------------------------+
| Header (149 B)   | Column Data (variable)                           |
+------------------+--------------------------------------------------+

Header:
  [version:     1 byte ]  Currently 0x01
  [column_size: 4 bytes]  Big-endian uint32, SSZ byte length of one DataColumnSidecar
  [bitmap:     16 bytes]  128-bit bitmap, bit i = 1 if column i is present
  [block_root: 32 bytes]  Block root for integrity verification
  [slot:        8 bytes]  Big-endian uint64, slot number
  [reserved:   88 bytes]  Zero-filled, reserved for future use

Total header: 1 + 4 + 16 + 32 + 8 + 88 = 149 bytes

Column data:
  [column_0_ssz: column_size bytes]  (if bitmap bit 0 is set)
  [column_1_ssz: column_size bytes]  (if bitmap bit 1 is set)
  ...
  [column_N_ssz: column_size bytes]  (if bitmap bit N is set)
```

#### Key Design Decisions

**Fixed-size columns (column_size field):** All DataColumnSidecar values for a given block have the same SSZ serialized length because they share the same number of blob commitments, proofs, and cells (determined by the block's blob count). The `column_size` field records this once, enabling O(1) seek to any column.

**128-bit bitmap:** With `NUMBER_OF_COLUMNS = 128`, a 16-byte bitmap (128 bits) is sufficient. Bit `i` being set indicates column `i` is present in the file. This supports:
- Partial column storage (supernode with subset of columns)
- Incremental writes (receive columns over time, update bitmap)
- O(1) existence checks without reading column data

**Block root and slot in header:** Enables integrity checks and allows recovery/validation without external index.

**Reserved bytes:** The 88-byte reserved region allows future header extensions (e.g., compression flags, checksum) without a format version bump.

#### Random Access Algorithm

To read column `i` from a `.dcol` file:

```
1. Read header (149 bytes)
2. Check bitmap bit i → if 0, column not present
3. Count set bits in bitmap[0..i-1] → position = popcount(bitmap & ((1 << i) - 1))
4. Seek to offset = 149 + position * column_size
5. Read column_size bytes → DataColumnSidecar SSZ
```

#### Size Analysis

Per data column sidecar with 6 blobs:
- Column data: 6 cells x 2,048 bytes = 12,288 bytes
- KZG commitments: 6 x 48 = 288 bytes
- KZG proofs: 6 x 48 = 288 bytes
- Signed block header: ~200 bytes
- Inclusion proof: 128 bytes
- SSZ container overhead: ~50 bytes
- **Total per column: ~13.2 KB**

Per block with 128 columns: 128 x 13.2 KB + 149 bytes header = **~1.69 MB**

Per block with 6 blobs (pre-fulu, blob sidecars only): **~786 KB**

Daily data volume (at 7,200 slots/day, assuming all slots have 6 blobs):
- Data columns: 7,200 x 1.69 MB = **~11.9 GB/day**
- Blob sidecars: 7,200 x 786 KB = **~5.5 GB/day**

With 18-day retention (`MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS` = 4096 epochs ≈ 18.2 days):
- Data columns: ~216 GB retained
- Blob sidecars: ~100 GB retained

### 2.3 Format Versioning

The version byte (currently `0x01`) in the `.dcol` header supports future format evolution:
- `0x01`: Current format (fixed-size columns, 128-bit bitmap)
- `0x02`: (future) Variable-size columns with per-column offset table
- `0x03`: (future) Compressed columns (zstd/snappy)

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
    await fd.datasync();      // fsync the data
    await fd.close();
    await fs.rename(tmpPath, targetPath);  // atomic on same filesystem
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
async function onDataColumnSidecars(
  slot: Slot, blockRoot: Root, columns: DataColumnSidecar[]
): Promise<void> {
  const dir = path.join(this.columnsDir, padSlot(slot));
  await fs.mkdir(dir, {recursive: true});
  const filePath = path.join(dir, `0x${toRootHex(blockRoot)}.dcol`);
  const existing = await this.readDcolHeader(filePath);
  const merged = existing ? mergeColumns(existing, columns) : packColumns(slot, blockRoot, columns);
  await atomicWrite(filePath, merged);
  this.existenceCache.setColumnsPresent(slot, blockRoot, columns.map(c => c.index));
}
```

### 3.3 Data Column Incremental Writes

Data columns may arrive incrementally (subset of 128 columns at a time). The `.dcol` format supports this:

1. **First write:** Create file with header + available columns, set bitmap bits.
2. **Subsequent writes:** Read existing file, merge new columns into the sorted position, update bitmap, atomic rewrite.

Since column data is fixed-size per block, merging is straightforward:
- Allocate new buffer: `149 + (existing_count + new_count) * column_size`
- Copy existing columns in order, insert new columns at correct positions
- Update bitmap
- Atomic write

**Concurrency:** A per-root `Mutex` (from an in-memory Map) ensures that concurrent column arrivals for the same block are serialized. The Map is keyed by `${slot}:${rootHex}` and entries are evicted after finalization.

```typescript
class ColumnWriteLock {
  private locks = new Map<string, Mutex>();

  async withLock<T>(slot: Slot, root: Root, fn: () => Promise<T>): Promise<T> {
    const key = `${slot}:${toRootHex(root)}`;
    let mutex = this.locks.get(key);
    if (!mutex) {
      mutex = new Mutex();
      this.locks.set(key, mutex);
    }
    return mutex.runExclusive(fn);
  }

  evict(slot: Slot, root: Root): void {
    this.locks.delete(`${slot}:${toRootHex(root)}`);
  }
}
```

### 3.4 Wire Format Passthrough

A major optimization: gossip-received blobs and columns arrive as SSZ bytes on the wire. Currently Lodestar deserializes them to typed objects, then re-serializes for LevelDB storage. With flat files, the raw wire bytes can be written directly if they've been validated:

```typescript
// Instead of: serialize(deserialize(wireBytes))
// Just: write(wireBytes)
async function onValidatedColumnBytes(
  slot: Slot, blockRoot: Root, columnIndex: ColumnIndex, sszBytes: Uint8Array
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

```typescript
async function getDataColumn(
  slot: Slot, blockRoot: Root, columnIndex: ColumnIndex
): Promise<DataColumnSidecar | null> {
  // Check existence cache
  if (!this.existenceCache.hasColumnPresent(slot, blockRoot, columnIndex)) {
    return null;
  }

  const filePath = path.join(this.columnsDir, padSlot(slot), `0x${toRootHex(blockRoot)}.dcol`);
  const fd = await fs.open(filePath, "r");
  try {
    // Read header
    const headerBuf = Buffer.alloc(DCOL_HEADER_SIZE);  // 149 bytes
    await fd.read(headerBuf, 0, DCOL_HEADER_SIZE, 0);
    const {columnSize, bitmap} = parseDcolHeader(headerBuf);

    // Check bitmap
    if (!getBit(bitmap, columnIndex)) return null;

    // Calculate offset using popcount
    const position = popcount(bitmap, columnIndex);
    const offset = DCOL_HEADER_SIZE + position * columnSize;

    // Read just the one column
    const columnBuf = Buffer.alloc(columnSize);
    await fd.read(columnBuf, 0, columnSize, offset);
    return ssz.fulu.DataColumnSidecar.deserialize(columnBuf);
  } finally {
    await fd.close();
  }
}
```

**Performance:** Reading a single column from a 1.69 MB file requires:
1. One 149-byte header read (likely cached by OS page cache)
2. One ~13 KB column read at a computed offset
3. No scanning, no iteration, no deserialization of other columns

### 4.3 Batch Reads (Multiple Columns for Same Block)

For data availability sampling, a node may need multiple columns from the same block:

```typescript
async function getDataColumns(
  slot: Slot, blockRoot: Root, columnIndices: ColumnIndex[]
): Promise<Map<ColumnIndex, DataColumnSidecar>> {
  const filePath = path.join(this.columnsDir, padSlot(slot), `0x${toRootHex(blockRoot)}.dcol`);
  const fd = await fs.open(filePath, "r");
  try {
    const headerBuf = Buffer.alloc(DCOL_HEADER_SIZE);
    await fd.read(headerBuf, 0, DCOL_HEADER_SIZE, 0);
    const {columnSize, bitmap} = parseDcolHeader(headerBuf);

    const result = new Map<ColumnIndex, DataColumnSidecar>();
    for (const idx of columnIndices) {
      if (!getBit(bitmap, idx)) continue;
      const position = popcount(bitmap, idx);
      const offset = DCOL_HEADER_SIZE + position * columnSize;
      const columnBuf = Buffer.alloc(columnSize);
      await fd.read(columnBuf, 0, columnSize, offset);
      result.set(idx, ssz.fulu.DataColumnSidecar.deserialize(columnBuf));
    }
    return result;
  } finally {
    await fd.close();
  }
}
```

For bulk reads (all 128 columns), reading the entire file at once and slicing is more efficient than 128 separate seeks.

---

## 5. In-Memory Existence Cache

### Purpose

Avoid filesystem `stat()` or `open()` calls for non-existent data. With 128 columns per block and frequent DA sampling, the cache prevents thousands of unnecessary syscalls per second.

### Data Structure

```typescript
class ExistenceCache {
  // Blob existence: slot → Set<rootHex>
  private blobs = new Map<Slot, Set<RootHex>>();

  // Column existence: slot → Map<rootHex, Uint16Array(1)>
  // The Uint16Array stores a 128-bit bitmap packed into 8 uint16 values
  // Actually, use a simple bigint or Buffer for the bitmap
  private columns = new Map<Slot, Map<RootHex, bigint>>();

  // Slot range tracked
  private minSlot: Slot = 0;
  private maxSlot: Slot = 0;
}
```

### Memory Usage

Per slot with one canonical block:
- Blob entry: ~80 bytes (RootHex string in Set)
- Column entry: ~96 bytes (RootHex string + bigint bitmap)

For 18-day retention window (~130,000 slots):
- Blobs: 130,000 x 80 = **~10 MB**
- Columns: 130,000 x 96 = **~12 MB**
- **Total: ~22 MB** (negligible)

### Cache Lifecycle

1. **Startup:** Walk the filesystem to rebuild cache (or load from a checkpoint file).
2. **Runtime:** Updated on every write and delete.
3. **Pruning:** Entries for pruned slots are batch-evicted.

### Warm-up Optimization

On startup, walking 130,000 slot directories could take 10-30 seconds. To avoid this:

1. **Persist cache to disk** periodically as a compact binary file:
   ```
   existence_cache.bin:
   [min_slot: 8B][max_slot: 8B][entries...]
   Each entry: [slot: 8B][root: 32B][blob_present: 1B][column_bitmap: 16B]
   ```
2. On startup, load the cache file and only scan slots newer than `max_slot` in the cache.
3. The cache file is written during graceful shutdown and periodically (every 5 minutes).

---

## 6. Pruning

### Pruning Algorithm

```typescript
async function pruneExpiredData(currentEpoch: Epoch): Promise<void> {
  const blobCutoffSlot = computeStartSlotAtEpoch(
    currentEpoch - config.MIN_EPOCHS_FOR_BLOB_SIDECARS_REQUESTS
  );
  const columnCutoffSlot = computeStartSlotAtEpoch(
    currentEpoch - config.MIN_EPOCHS_FOR_DATA_COLUMN_SIDECARS_REQUESTS
  );

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

Add a `--flatFileStorage` CLI flag (default: `false`).

When enabled:
- New blob sidecars and data columns are written to both LevelDB and filesystem
- Reads prefer filesystem, fall back to LevelDB
- Pruning operates on both stores

This allows safe testing with easy rollback (just disable the flag).

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
  // Blob sidecars
  getBlobSidecars(slot: Slot, blockRoot: Root): Promise<BlobSidecarsWrapper | null>;
  getBlobSidecarsBinary(slot: Slot, blockRoot: Root): Promise<Uint8Array | null>;
  putBlobSidecars(slot: Slot, blockRoot: Root, data: Uint8Array): Promise<void>;
  deleteBlobSidecars(slot: Slot, blockRoot: Root): Promise<void>;
  hasBlobSidecars(slot: Slot, blockRoot: Root): boolean;  // sync, from cache

  // Data columns
  getDataColumn(slot: Slot, blockRoot: Root, index: ColumnIndex): Promise<DataColumnSidecar | null>;
  getDataColumnBinary(slot: Slot, blockRoot: Root, index: ColumnIndex): Promise<Uint8Array | null>;
  getDataColumns(slot: Slot, blockRoot: Root, indices: ColumnIndex[]): Promise<Map<ColumnIndex, Uint8Array>>;
  putDataColumns(slot: Slot, blockRoot: Root, columns: {index: ColumnIndex; data: Uint8Array}[]): Promise<void>;
  deleteDataColumns(slot: Slot, blockRoot: Root): Promise<void>;
  hasDataColumn(slot: Slot, blockRoot: Root, index: ColumnIndex): boolean;  // sync, from cache
  getColumnBitmap(slot: Slot, blockRoot: Root): bigint | null;  // sync, from cache

  // Pruning
  pruneBeforeSlot(slot: Slot): Promise<void>;

  // Lifecycle
  init(): Promise<void>;
  close(): Promise<void>;
}
```

### Changes to IBeaconDb

```typescript
export interface IBeaconDb {
  // ... existing fields ...

  // NEW: flat file store for blobs and columns
  flatFileStore: IFlatFileStore;

  // DEPRECATED (Phase 1a: still present, Phase 1c: removed)
  blobSidecars: BlobSidecarsRepository;
  blobSidecarsArchive: BlobSidecarsArchiveRepository;
  dataColumnSidecar: DataColumnSidecarRepository;
  dataColumnSidecarArchive: DataColumnSidecarArchiveRepository;
}
```

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

| Operation | LevelDB (current) | Flat File (proposed) |
|-----------|-------------------|---------------------|
| Initial write | 1x write + LSM compaction (10-30x over lifetime) | 1x write + fsync |
| Hot→cold migration | 1x read + 1x write + 1x delete + compaction | Not needed |
| Pruning | 1x delete + compaction to reclaim space | 1x unlink (instant reclaim) |
| **Total write amplification** | **~15-50x** | **~1x** |

### Disk Usage

| | LevelDB | Flat File |
|--|---------|-----------|
| Storage overhead | ~1.1-1.5x (SSZ + LevelDB metadata + LSM levels) | ~1.0x (raw SSZ + 149B header for .dcol) |
| Post-delete bloat | Significant until compaction | None (unlink reclaims immediately) |
| Fragmentation | Internal (LSM levels) | Filesystem-level (minimal with modern ext4/xfs) |

### Read Latency

| Operation | LevelDB | Flat File |
|-----------|---------|-----------|
| Single blob lookup | ~0.5-2ms (key lookup + decompress) | ~0.1-0.5ms (open + read, cached by OS) |
| Single column lookup | ~0.5-2ms (key lookup + decompress) | ~0.1-0.3ms (open + header read + seek + read) |
| Existence check | ~0.3-1ms (key lookup) | **~0ns** (in-memory cache) |
| Range scan (all columns for block) | ~5-15ms (128 key lookups) | ~1-3ms (single file read) |

### Throughput (Sustained Writes)

| | LevelDB | Flat File |
|--|---------|-----------|
| 128 columns/block at 12s interval | Bottleneck: LSM compaction contention | 128 sequential writes, no contention |
| Concurrent block processing | Single LevelDB lock | Independent files, full parallelism |

### Pruning Speed

| | LevelDB | Flat File |
|--|---------|-----------|
| Prune 1 epoch (32 slots, ~54 MB columns) | 10-30 seconds (scan + delete + compact) | <1 second (32 x rm -rf) |
| Prune 1 day (225 epochs, ~12 GB columns) | Minutes (heavy I/O, blocks other operations) | ~5-10 seconds |

---

## 10. Implementation Plan

### Module Structure

```
packages/beacon-node/src/db/
  flatFileStore/
    index.ts                    # Exports
    flatFileStore.ts            # Main FlatFileStore class implementing IFlatFileStore
    blobStore.ts                # Blob sidecar file operations
    columnStore.ts              # Data column file operations
    dcolFormat.ts               # .dcol binary format encode/decode
    existenceCache.ts           # In-memory existence bitmap cache
    atomicWrite.ts              # Atomic write utility
    metrics.ts                  # Prometheus metrics
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

3. **Should we support compression?** Data columns are somewhat compressible (KZG commitments and proofs have structure). However, compression adds CPU overhead and prevents O(1) random access. Recommendation: no compression in v1, add optional per-file compression in v2 using the version byte.

4. **Should the existence cache be shared or per-store?** A single cache for both blobs and columns simplifies management. Recommendation: single `ExistenceCache` instance in `FlatFileStore`.

5. **What happens during backfill sync?** Backfilling historical data should write directly to flat files in the same format. The `updateBackfillRange` logic in `archiveStore` needs to be updated to interact with `IFlatFileStore`.
