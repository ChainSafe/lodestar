import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer, toRootHex} from "@lodestar/utils";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {ProposerPreferencesCache} from "../../../src/services/proposerPreferencesCache.js";
import {ProposerPreferencesTracker} from "../../../src/services/proposerPreferencesTracker.js";
import {getMockedLogger} from "../utils/logger.js";
import {mockBuiltPayload} from "../utils/payload.js";

const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 1)), pubkey: "builder"};
const slot = SLOTS_PER_EPOCH + 3;

function preferences(target = slot, root = 1) {
  const signed = ssz.gloas.SignedProposerPreferences.defaultValue();
  signed.message.proposalSlot = target;
  signed.message.dependentRoot.fill(root);
  return signed;
}

describe("ProposerPreferencesCache", () => {
  let directory: string;
  let filename: string;
  let logger: ReturnType<typeof getMockedLogger>;
  let cache: ProposerPreferencesCache;
  let tracker: ProposerPreferencesTracker;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "builder-preferences-"));
    filename = path.join(directory, "proposer-preferences.json");
    logger = getMockedLogger();
    cache = new ProposerPreferencesCache(filename, identity, logger);
    tracker = new ProposerPreferencesTracker();
  });

  afterEach(async () => {
    await cache.close(tracker, slot);
    vi.restoreAllMocks();
    await fs.rm(directory, {recursive: true, force: true});
  });

  it("restores upcoming validated preferences with exact dependent-root matching after restart", async () => {
    const current = preferences();
    const future = preferences(slot + 1, 2);
    for (const entry of [preferences(slot - 1), current, future, preferences(3 * SLOTS_PER_EPOCH)])
      tracker.onProposerPreferences(entry);
    await cache.close(tracker, slot);
    const restored = new ProposerPreferencesTracker();
    expect(await new ProposerPreferencesCache(filename, identity, logger).load(restored, slot)).toBe(2);
    expect(restored.get(slot, toRootHex(current.message.dependentRoot))).toEqual(current);
    expect(restored.get(slot, toRootHex(future.message.dependentRoot))).toBeNull();
    expect(restored.get(slot + 1, toRootHex(future.message.dependentRoot))).toEqual(future);
    expect((await fs.stat(filename)).mode & 0o777).toBe(0o600);
    expect(
      await new ProposerPreferencesCache(filename, identity, logger).load(new ProposerPreferencesTracker(), slot + 2)
    ).toBe(0);
  });

  it.each(["network", "identity", "checksum", "truncated", "oversized", "malformed entry"])(
    "ignores a cache with invalid %s without partially restoring it",
    async (kind) => {
      tracker.onProposerPreferences(preferences());
      await cache.save(tracker, slot);
      let expected = identity;
      if (kind === "network") expected = {...identity, genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 2))};
      if (kind === "identity") expected = {...identity, pubkey: "another"};
      if (kind === "truncated") await fs.writeFile(filename, "{");
      if (kind === "oversized") await fs.writeFile(filename, Buffer.alloc(256 * 1024 + 1));
      if (kind === "checksum" || kind === "malformed entry") {
        const record = JSON.parse(await fs.readFile(filename, "utf8"));
        if (kind === "checksum") record.checksum = "bad";
        else {
          record.data.preferences.push({message: {}, signature: "0x"});
          record.checksum = createHash("sha256").update(JSON.stringify(record.data)).digest("hex");
        }
        await fs.writeFile(filename, JSON.stringify(record));
      }
      const restored = new ProposerPreferencesTracker();
      expect(await new ProposerPreferencesCache(filename, expected, logger).load(restored, slot)).toBe(0);
      expect(restored.count(slot)).toBe(0);
      expect(logger.warn).toHaveBeenCalledOnce();
    }
  );

  it("bounds roots and future slots in snapshots", async () => {
    for (let i = 0; i < 20; i++) tracker.onProposerPreferences(preferences(slot, i));
    tracker.onProposerPreferences(preferences(slot + SLOTS_PER_EPOCH * 10));
    await cache.save(tracker, slot);
    const restored = new ProposerPreferencesTracker();
    expect(await new ProposerPreferencesCache(filename, identity, logger).load(restored, slot)).toBe(4);
  });

  it("coalesces writes and drains the latest snapshot on close", async () => {
    const entered = defer<void>();
    const release = defer<void>();
    const rename = fs.rename;
    const spy = vi.spyOn(fs, "rename").mockImplementationOnce(async (...args) => {
      entered.resolve();
      await release.promise;
      await rename(...args);
    });
    tracker.onProposerPreferences(preferences());
    const first = cache.save(tracker, slot);
    await entered.promise;
    for (let i = 1; i < 20; i++) {
      tracker.onProposerPreferences(preferences(slot + i));
      void cache.save(tracker, slot);
    }
    const closed = cache.close(tracker, slot);
    release.resolve();
    await Promise.all([first, closed]);
    expect(spy).toHaveBeenCalledTimes(2);
    const restored = new ProposerPreferencesTracker();
    expect(await new ProposerPreferencesCache(filename, identity, logger).load(restored, slot)).toBe(20);
  });

  it("keeps the previous complete snapshot on a failed write and retries later", async () => {
    tracker.onProposerPreferences(preferences());
    await cache.save(tracker, slot);
    tracker.onProposerPreferences(preferences(slot + 1));
    vi.spyOn(fs, "rename").mockRejectedValueOnce(Error("disk error"));
    await cache.save(tracker, slot);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(
      await new ProposerPreferencesCache(filename, identity, logger).load(new ProposerPreferencesTracker(), slot)
    ).toBe(1);
    await cache.save(tracker, slot);
    expect(
      await new ProposerPreferencesCache(filename, identity, logger).load(new ProposerPreferencesTracker(), slot)
    ).toBe(2);
  });

  it("never rejects shutdown for an oversized optional snapshot", async () => {
    tracker.onProposerPreferences(preferences());
    await cache.save(tracker, slot);
    vi.spyOn(tracker, "snapshot").mockReturnValue(Array.from({length: 3000}, () => preferences()));
    await expect(cache.close(tracker, slot)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(
      await new ProposerPreferencesCache(filename, identity, logger).load(new ProposerPreferencesTracker(), slot)
    ).toBe(1);
  });

  it("coexists with recovered critical commitments and an interrupted cache write", async () => {
    const journal = new CommitmentJournal(directory, identity);
    const payload = mockBuiltPayload({slot, blockHash: Buffer.alloc(32, 1), valueGwei: 1});
    const signed = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    signed.message.slot = slot;
    signed.message.blockHash = payload.executionPayload.blockHash;
    signed.message.parentBlockHash = payload.executionPayload.parentHash;
    signed.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
    journal.retain(signed, {
      slot,
      blockHash: toRootHex(signed.message.blockHash),
      parentBlockRoot: signed.message.parentBlockRoot,
      payload,
    });
    tracker.onProposerPreferences(preferences());
    await cache.save(tracker, slot);
    await fs.writeFile(`${filename}.tmp`, "interrupted");
    const recovered = new CommitmentJournal(directory, identity, slot);
    expect(recovered.recover(slot, new PayloadStore(), new BidStore(), new BidLedger())).toBe(1);
    expect(
      await new ProposerPreferencesCache(filename, identity, logger).load(new ProposerPreferencesTracker(), slot)
    ).toBe(1);
  });
});
