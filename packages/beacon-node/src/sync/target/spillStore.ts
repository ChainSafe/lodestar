import {RootHex, SignedBeaconBlock, Slot} from "@lodestar/types";
import {LodestarError, Logger, fromHex} from "@lodestar/utils";
import {TargetSyncBlockRepository} from "../../db/repositories/index.js";

// ---------------------------------------------------------------------------
// SpillStore — per-target block staging with a bounded memory buffer, a
// db spill tier, byte quotas, and abort-aware operations.
//
// Ownership & crash model: every row a SpillStore writes is tracked in its
// in-memory `spilled` index, so all in-process deletion paths (per-segment,
// per-target terminal, below-finality) are exact and never scan the db. After
// a crash the index is gone and the rows are garbage by definition — the
// UNCONDITIONAL boot wipe (`wipeTargetSyncSpillOnBoot`, called from BeaconSync
// init regardless of the engine flag [A1]) is the one deletion path that
// survives SIGKILL.
// ---------------------------------------------------------------------------

/** Default per-target spill quota [A7]: 32k fulu blocks at p95 sizes ≈ 3.2–4.8 GiB. */
export const SPILL_QUOTA_PER_TARGET_BYTES = 6 * 1024 ** 3;
/** Default global spill quota across all targets [A7]. */
export const SPILL_QUOTA_GLOBAL_BYTES = 8 * 1024 ** 3;
/** Blocks held in memory per target before spilling the oldest to db. */
export const SPILL_MEM_BUFFER_BLOCKS = 128;
/** Fraction of a quota at which a warning is logged (once, with hysteresis). */
const QUOTA_WARN_FRACTION = 0.8;
const QUOTA_WARN_RESET_FRACTION = 0.7;
/** Boot-wipe row count above which the log recommends a fresh checkpoint sync [A16]. */
const BOOT_WIPE_CHECKPOINT_HINT_ROWS = 10_000;

export enum SpillStoreErrorCode {
  QUOTA_EXCEEDED = "TARGET_SYNC_SPILL_QUOTA_EXCEEDED",
}

export type SpillStoreErrorType = {
  code: SpillStoreErrorCode.QUOTA_EXCEEDED;
  scope: "target" | "global";
  usedBytes: number;
  quotaBytes: number;
};

/**
 * Thrown BEFORE any db write when accepting a block would breach a spill quota.
 * The caller's directive: the gap is too large for backward sync — recommend a
 * fresh checkpoint sync and terminate the target `exhausted`.
 */
export class SpillQuotaError extends LodestarError<SpillStoreErrorType> {}

export type SpillMetrics = {
  bootWipeRowsTotal: {inc(value: number): void};
  spillBytes: {set(value: number): void};
} | null;

export type SpillQuotas = {
  perTargetBytes: number;
  globalBytes: number;
  /** Blocks held in memory per target before spilling the oldest to db. */
  memBufferBlocks: number;
};

export const DEFAULT_SPILL_QUOTAS: SpillQuotas = {
  perTargetBytes: SPILL_QUOTA_PER_TARGET_BYTES,
  globalBytes: SPILL_QUOTA_GLOBAL_BYTES,
  memBufferBlocks: SPILL_MEM_BUFFER_BLOCKS,
};

/**
 * Process-wide spill accounting shared by every per-target store: one byte
 * ledger, one repo handle, one quota policy.
 */
export class SpillStoreGlobal {
  /** Total bytes currently spilled across all targets. */
  bytes = 0;
  private warnedGlobal = false;

  constructor(
    readonly repo: TargetSyncBlockRepository,
    readonly quotas: SpillQuotas,
    private readonly logger: Logger,
    private readonly metrics: SpillMetrics = null
  ) {}

  forTarget(targetRoot: RootHex): SpillStore {
    return new SpillStore(this, targetRoot, this.logger);
  }

  /** Enforce quotas for a prospective spill of `addBytes` for a target currently at `targetBytes`. */
  checkQuota(targetBytes: number, addBytes: number): void {
    if (targetBytes + addBytes > this.quotas.perTargetBytes) {
      throw new SpillQuotaError({
        code: SpillStoreErrorCode.QUOTA_EXCEEDED,
        scope: "target",
        usedBytes: targetBytes,
        quotaBytes: this.quotas.perTargetBytes,
      });
    }
    if (this.bytes + addBytes > this.quotas.globalBytes) {
      throw new SpillQuotaError({
        code: SpillStoreErrorCode.QUOTA_EXCEEDED,
        scope: "global",
        usedBytes: this.bytes,
        quotaBytes: this.quotas.globalBytes,
      });
    }
  }

  onBytes(delta: number): void {
    this.bytes += delta;
    this.metrics?.spillBytes.set(this.bytes);

    if (!this.warnedGlobal && this.bytes > this.quotas.globalBytes * QUOTA_WARN_FRACTION) {
      this.warnedGlobal = true;
      this.logger.warn("TargetSync global spill above 80% of quota", {
        bytes: this.bytes,
        quotaBytes: this.quotas.globalBytes,
      });
    } else if (this.warnedGlobal && this.bytes < this.quotas.globalBytes * QUOTA_WARN_RESET_FRACTION) {
      this.warnedGlobal = false;
    }
  }
}

/**
 * Per-target block staging. Insertion-ordered memory buffer (oldest-inserted
 * spills first — walk order means oldest-inserted ≈ newest slot, keeping the
 * blocks nearest the intersection, which import drains first, in memory last).
 */
export class SpillStore {
  /** In-memory tier, insertion-ordered. */
  private readonly mem = new Map<RootHex, SignedBeaconBlock>();
  /** Exact index of what this store spilled: root → {slot, bytes}. */
  private readonly spilled = new Map<RootHex, {slot: Slot; bytes: number}>();
  private readonly targetRootBytes: Uint8Array;
  /** Bytes this target holds in the db tier. */
  bytes = 0;
  private warnedTarget = false;

  constructor(
    private readonly global: SpillStoreGlobal,
    readonly targetRoot: RootHex,
    private readonly logger: Logger
  ) {
    this.targetRootBytes = fromHex(targetRoot);
  }

  /** Blocks currently held (both tiers). */
  get size(): number {
    return this.mem.size + this.spilled.size;
  }

  /**
   * Stage a block. Quotas are enforced BEFORE any db write; a breach throws
   * `SpillQuotaError` and leaves both tiers untouched.
   */
  async put(root: RootHex, block: SignedBeaconBlock, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    if (this.mem.has(root) || this.spilled.has(root)) return;

    if (this.mem.size >= this.global.quotas.memBufferBlocks) {
      // Make room by spilling the oldest-inserted block — bounds checked first.
      const oldest = this.mem.entries().next().value as [RootHex, SignedBeaconBlock];
      const [oldRoot, oldBlock] = oldest;
      const data = this.global.repo.encodeValue(oldBlock);
      this.global.checkQuota(this.bytes, data.length);

      try {
        await this.global.repo.putBinary(this.targetRootBytes, this.global.repo.getId(oldBlock), data);
      } catch (e) {
        if (signal?.aborted) {
          // [A12] A write racing engine close is expected; the boot wipe owns the row either way.
          this.logger.debug("TargetSync spill write after abort", {target: this.targetRoot}, e as Error);
          return;
        }
        throw e;
      }

      this.mem.delete(oldRoot);
      this.spilled.set(oldRoot, {slot: oldBlock.message.slot, bytes: data.length});
      this.bytes += data.length;
      this.global.onBytes(data.length);

      if (!this.warnedTarget && this.bytes > this.global.quotas.perTargetBytes * QUOTA_WARN_FRACTION) {
        this.warnedTarget = true;
        this.logger.warn("TargetSync target spill above 80% of quota", {
          target: this.targetRoot,
          bytes: this.bytes,
          quotaBytes: this.global.quotas.perTargetBytes,
        });
      } else if (this.warnedTarget && this.bytes < this.global.quotas.perTargetBytes * QUOTA_WARN_RESET_FRACTION) {
        this.warnedTarget = false;
      }
    }

    this.mem.set(root, block);
  }

  /** Read a staged block; `null` when absent (the caller defers). */
  async get(root: RootHex, slot: Slot, signal?: AbortSignal): Promise<SignedBeaconBlock | null> {
    const inMem = this.mem.get(root);
    if (inMem !== undefined) return inMem;
    // The spilled index is authoritative for what we wrote — a miss needs no db round trip.
    if (!this.spilled.has(root)) return null;
    if (signal?.aborted) return null;
    try {
      return await this.global.repo.get(this.targetRootBytes, this.global.repo.encodeId(slot, fromHex(root)));
    } catch (e) {
      if (signal?.aborted) return null;
      throw e;
    }
  }

  /**
   * Release every staged block at `slot <= upToSlot` — the per-segment cleanup
   * path after a successful import (spill size doubles as a live progress signal).
   */
  async deleteUpToSlot(upToSlot: Slot, signal?: AbortSignal): Promise<void> {
    for (const [root, block] of this.mem) {
      if (block.message.slot <= upToSlot) this.mem.delete(root);
    }

    const dels: {root: RootHex; slot: Slot; bytes: number}[] = [];
    for (const [root, entry] of this.spilled) {
      if (entry.slot <= upToSlot) dels.push({root, slot: entry.slot, bytes: entry.bytes});
    }
    if (dels.length === 0) return;

    try {
      await this.global.repo.batch(
        this.targetRootBytes,
        dels.map((d) => ({type: "del" as const, key: this.global.repo.encodeId(d.slot, fromHex(d.root))}))
      );
    } catch (e) {
      if (signal?.aborted) {
        this.logger.debug("TargetSync spill delete after abort", {target: this.targetRoot}, e as Error);
        return;
      }
      throw e;
    }

    let freed = 0;
    for (const d of dels) {
      this.spilled.delete(d.root);
      freed += d.bytes;
    }
    this.bytes -= freed;
    this.global.onBytes(-freed);
  }

  /**
   * Release everything this target holds — the terminal path. Memory release
   * is synchronous and unconditional; the db delete is best-effort under abort
   * (the boot wipe owns crash/close leftovers).
   */
  async clear(signal?: AbortSignal): Promise<void> {
    this.mem.clear();
    const hadSpill = this.spilled.size > 0;
    this.spilled.clear();
    const freed = this.bytes;
    this.bytes = 0;
    if (freed > 0) this.global.onBytes(-freed);
    if (!hadSpill) return;
    // close() discipline: memory is released above; an aborted signal means the engine is
    // closing — issue NO db work at all (the boot wipe owns the rows).
    if (signal?.aborted) return;

    try {
      await this.global.repo.deleteMany(this.targetRootBytes);
    } catch (e) {
      if (signal?.aborted) {
        this.logger.debug("TargetSync spill clear after abort", {target: this.targetRoot}, e as Error);
        return;
      }
      throw e;
    }
  }
}

/**
 * [A1] Unconditional boot hygiene: truncate the TargetSync spill bucket on
 * EVERY node boot, regardless of whether the engine is constructed and
 * regardless of fork. Never rejects — boot must not fail on hygiene.
 *
 * The returned count is a free crash detector: a non-zero count means the
 * previous process died without releasing its spill.
 */
export async function wipeTargetSyncSpillOnBoot(
  repo: TargetSyncBlockRepository,
  logger: Logger,
  metrics: SpillMetrics = null
): Promise<number> {
  try {
    const rows = await repo.truncateAll();
    metrics?.bootWipeRowsTotal.inc(rows);
    if (rows > BOOT_WIPE_CHECKPOINT_HINT_ROWS) {
      // [A16] A large leaked spill means the node crashed mid-sync over a large gap. If this
      // repeats, re-walking the gap every boot is the wrong recovery — a fresh checkpoint sync is.
      logger.warn(
        "TargetSync spill contained many rows from an unclean shutdown — if the node is far behind and this repeats, consider a fresh checkpoint sync (--checkpointSyncUrl)",
        {rows}
      );
    } else if (rows > 0) {
      logger.info("Cleaned TargetSync spill rows from an unclean shutdown", {rows});
    }
    return rows;
  } catch (e) {
    logger.error("TargetSync spill boot wipe failed", {}, e as Error);
    return 0;
  }
}
