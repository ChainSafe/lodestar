import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDbController} from "@lodestar/db/controller/level";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {SignedBeaconBlock, Slot} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {TargetSyncBlockRepository} from "../../../../src/db/repositories/index.js";
import {
  SpillQuotaError,
  SpillQuotas,
  SpillStoreGlobal,
  wipeTargetSyncSpillOnBoot,
} from "../../../../src/sync/target/spillStore.js";
import {config, generateBlock, slots} from "../../../utils/blocksAndData.js";

/** Normalize the random 192-byte test signature to a valid SSZ 96-byte one (see chainBlockStore.test.ts). */
function withValidSignature(block: SignedBeaconBlock): SignedBeaconBlock {
  return {...block, signature: new Uint8Array(96)};
}

function makeBlock(slot: Slot): {root: string; block: SignedBeaconBlock} {
  const {block: raw, blockRoot} = generateBlock({forkName: ForkName.gloas, slot});
  return {root: toRootHex(blockRoot), block: withValidSignature(raw)};
}

const BIG = 1024 ** 3;

describe("sync / target / spillStore", () => {
  const testDir = "./.tmp_spill_store_unit_test";
  const baseSlot = slots.gloas + 100;
  let db: LevelDbController;
  let repo: TargetSyncBlockRepository;
  const logger = testLogger();

  function makeGlobal(quotas: Partial<SpillQuotas> = {}): SpillStoreGlobal {
    return new SpillStoreGlobal(repo, {perTargetBytes: BIG, globalBytes: BIG, memBufferBlocks: 1, ...quotas}, logger);
  }

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger});
    repo = new TargetSyncBlockRepository(config, db);
  });

  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  it("repo keys are slot-ordered: entriesStream yields ascending slots regardless of insert order", async () => {
    const target = makeBlock(baseSlot + 10);
    const targetRootBytes = Buffer.from(target.root.slice(2), "hex");
    const blocks = [baseSlot + 5, baseSlot + 1, baseSlot + 9, baseSlot + 3].map((s) => makeBlock(s).block);
    for (const b of blocks) {
      await repo.putSized(targetRootBytes, b);
    }

    const seenSlots: Slot[] = [];
    for await (const {value} of repo.entriesStream(targetRootBytes)) {
      seenSlots.push(value.message.slot);
    }
    expect(seenSlots).toEqual([baseSlot + 1, baseSlot + 3, baseSlot + 5, baseSlot + 9]);
  });

  it("round-trips across both tiers and releases per segment (deleteUpToSlot)", async () => {
    const global = makeGlobal(); // memBufferBlocks=1 → every second put spills
    const a = makeBlock(baseSlot);
    const b = makeBlock(baseSlot + 1);
    const c = makeBlock(baseSlot + 2);
    const store = global.forTarget(c.root);

    await store.put(a.root, a.block);
    await store.put(b.root, b.block); // spills a
    await store.put(c.root, c.block); // spills b
    expect(store.size).toBe(3);
    expect(store.bytes).toBeGreaterThan(0);
    expect(global.bytes).toBe(store.bytes);

    // Both tiers readable.
    expect(await store.get(c.root, baseSlot + 2)).toBe(c.block); // memory
    const fromDisk = await store.get(a.root, baseSlot);
    expect(fromDisk).not.toBeNull();
    expect(config.getForkTypes(baseSlot).SignedBeaconBlock.equals(fromDisk as SignedBeaconBlock, a.block)).toBe(true);

    // Per-segment release: everything at slot <= baseSlot+1 goes; bytes accounting follows.
    await store.deleteUpToSlot(baseSlot + 1);
    expect(await store.get(a.root, baseSlot)).toBeNull();
    expect(await store.get(b.root, baseSlot + 1)).toBeNull();
    expect(await store.get(c.root, baseSlot + 2)).toBe(c.block);
    expect(store.bytes).toBe(0); // a & b were the only spilled rows
    expect(global.bytes).toBe(0);
  });

  it("enforces the per-target quota BEFORE any write", async () => {
    const global = makeGlobal({perTargetBytes: 10}); // smaller than any serialized block
    const a = makeBlock(baseSlot);
    const b = makeBlock(baseSlot + 1);
    const store = global.forTarget(b.root);

    await store.put(a.root, a.block); // in memory, no spill yet
    // Second put must spill `a` — which would breach the quota — and throw without writing.
    await expect(store.put(b.root, b.block)).rejects.toThrow(SpillQuotaError);
    expect(store.bytes).toBe(0);
    expect(global.bytes).toBe(0);
    // Nothing landed in the db.
    expect(await repo.values(Buffer.from(b.root.slice(2), "hex"))).toEqual([]);
    // The in-memory block is untouched.
    expect(await store.get(a.root, baseSlot)).toBe(a.block);
  });

  it("enforces the global quota across targets", async () => {
    const a = makeBlock(baseSlot);
    const sizeOfA = repo.encodeValue(a.block).length;
    // Global fits exactly one spilled block; per-target would allow more.
    const global = makeGlobal({globalBytes: sizeOfA + 8});

    const t1 = makeBlock(baseSlot + 50);
    const t2 = makeBlock(baseSlot + 60);
    const store1 = global.forTarget(t1.root);
    const store2 = global.forTarget(t2.root);

    const b1 = makeBlock(baseSlot + 1);
    await store1.put(a.root, a.block);
    await store1.put(b1.root, b1.block); // spills a → fits
    expect(global.bytes).toBeGreaterThan(0);

    const c = makeBlock(baseSlot + 2);
    const d = makeBlock(baseSlot + 3);
    await store2.put(c.root, c.block);
    await expect(store2.put(d.root, d.block)).rejects.toThrow(SpillQuotaError); // global breach
  });

  it("clear releases db rows and global accounting; other targets unaffected", async () => {
    const global = makeGlobal();
    const t1 = makeBlock(baseSlot + 50);
    const t2 = makeBlock(baseSlot + 60);
    const store1 = global.forTarget(t1.root);
    const store2 = global.forTarget(t2.root);

    const a = makeBlock(baseSlot);
    const b = makeBlock(baseSlot + 1);
    await store1.put(a.root, a.block);
    await store1.put(b.root, b.block); // spills a under t1

    const c = makeBlock(baseSlot + 2);
    const d = makeBlock(baseSlot + 3);
    await store2.put(c.root, c.block);
    await store2.put(d.root, d.block); // spills c under t2
    const t2Bytes = store2.bytes;

    await store1.clear();
    expect(store1.bytes).toBe(0);
    expect(await store1.get(a.root, baseSlot)).toBeNull();
    expect(global.bytes).toBe(t2Bytes);
    // t2's spilled row survives.
    expect(await store2.get(c.root, baseSlot + 2)).not.toBeNull();
  });

  it("abort semantics [A12]: aborted put is a no-op; post-abort db errors are swallowed", async () => {
    const global = makeGlobal();
    const t = makeBlock(baseSlot + 50);
    const store = global.forTarget(t.root);
    const a = makeBlock(baseSlot);
    const b = makeBlock(baseSlot + 1);

    const aborted = AbortSignal.abort();
    await store.put(a.root, a.block, aborted);
    expect(store.size).toBe(0); // no-op

    // Stage a spilled row, then close the db: a clear() racing close must not reject
    // when the signal is aborted (the boot wipe owns the rows either way).
    await store.put(a.root, a.block);
    await store.put(b.root, b.block); // spills a
    await db.close();
    await expect(store.clear(aborted)).resolves.toBeUndefined();

    // Reopen so afterEach can close cleanly.
    db = await LevelDbController.create({name: testDir}, {logger});
  });

  it("boot wipe [A1] truncates everything across targets and reports the count", async () => {
    const t1 = Buffer.alloc(32, 1);
    const t2 = Buffer.alloc(32, 2);
    let rows = 0;
    for (let i = 0; i < 5; i++) {
      await repo.putSized(i % 2 === 0 ? t1 : t2, makeBlock(baseSlot + i).block);
      rows++;
    }

    const inc = vi.fn();
    const wiped = await wipeTargetSyncSpillOnBoot(repo, logger, {
      bootWipeRowsTotal: {inc},
      spillBytes: {set: vi.fn()},
    });
    expect(wiped).toBe(rows);
    expect(inc).toHaveBeenCalledWith(rows);
    expect(await repo.values(t1)).toEqual([]);
    expect(await repo.values(t2)).toEqual([]);

    // Idempotent + clean on empty.
    expect(await wipeTargetSyncSpillOnBoot(repo, logger)).toBe(0);
  });

  it("boot wipe never rejects (db failure → logged, returns 0)", async () => {
    const badRepo = {truncateAll: vi.fn().mockRejectedValue(new Error("db closed"))};
    await expect(wipeTargetSyncSpillOnBoot(badRepo as unknown as TargetSyncBlockRepository, logger)).resolves.toBe(0);
  });
});
