import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {LevelDbController} from "@lodestar/db";
import {ssz} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {BeaconDb} from "../../../src/db/beacon.js";
import {ServingBlockCertification} from "../../../src/db/blockCertification.js";

const MAX_PAYLOAD_SIZE = 64 * 1024;
const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  MAX_PAYLOAD_SIZE,
});
const logger = {debug: vi.fn(), verbose: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn()} as unknown as Logger;

/** A Capella block at `slot`, above MAX_PAYLOAD_SIZE when `oversized` */
function block(slot: number, oversized = false) {
  const signedBlock = ssz.capella.SignedBeaconBlock.defaultValue();
  signedBlock.message.slot = slot;
  if (oversized) signedBlock.message.body.executionPayload.transactions = [new Uint8Array(MAX_PAYLOAD_SIZE)];
  const bytes = ssz.capella.SignedBeaconBlock.serialize(signedBlock);
  return {bytes, root: toRootHex(ssz.capella.BeaconBlock.hashTreeRoot(signedBlock.message))};
}

async function withDb(run: (db: BeaconDb, restart: () => BeaconDb) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "lodestar-block-certification-"));
  const controller = await LevelDbController.create({name: path}, {logger});
  try {
    // A restart constructs the certification again over the same database
    await run(new BeaconDb(config, controller), () => new BeaconDb(config, controller));
  } finally {
    await controller.close();
    await rm(path, {recursive: true, force: true});
  }
}

async function archive(db: BeaconDb, slots: number[], oversized: number[] = []): Promise<void> {
  for (const slot of slots) await db.blockArchive.putBinary(slot, block(slot, oversized.includes(slot)).bytes);
}

describe("serving block certification", () => {
  it("certifies no block until loaded, then leaves the archived slots after genesis unverified", async () =>
    withDb(async (db) => {
      await archive(db, [0, 5, 9]);
      const certification = db.blockCertification;
      expect(certification.hotVerified).toBe(false);
      for (const slot of [0, 5, 100]) expect(certification.isArchiveSlotVerified(slot)).toBe(false);

      expect(await certification.load()).toEqual({from: 5, to: 9});
      expect([0, 4, 5, 9, 10].map((slot) => certification.isArchiveSlotVerified(slot))).toEqual([
        true,
        true,
        false,
        false,
        true,
      ]);
      expect(certification.isArchiveRangeVerified(0, 4)).toBe(true);
      expect(certification.isArchiveRangeVerified(4, 5)).toBe(false);
      expect(certification.isArchiveRangeVerified(10, 20)).toBe(true);
    }));

  it("certifies a new database and its genesis block", async () =>
    withDb(async (db, restart) => {
      expect(await db.blockCertification.load()).toBeNull();
      expect(db.blockCertification.isArchiveRangeVerified(0, 100)).toBe(true);
      await archive(db, [0]);
      expect(await restart().blockCertification.load()).toBeNull();
    }));

  it("keeps verification across restarts while the writer canary survives, this build's hot prune included", async () =>
    withDb(async (db, restart) => {
      await archive(db, [5, 6, 7]);
      expect(await db.blockCertification.load()).toEqual({from: 5, to: 7});
      expect(await db.blockCertification.verifyArchive()).toBeNull();
      const blobs = {blockRoot: new Uint8Array(32).fill(1), slot: 5, blobSidecars: []};
      await db.blobSidecars.add(blobs);

      const restarted = restart();
      await restarted.pruneHotDb();
      expect(await restarted.blobSidecars.getBinary(blobs.blockRoot)).toBeNull();
      expect(await restarted.blockCertification.load()).toBeNull();
    }));

  it("invalidates verification after a build without it started, even for a write below the verified slots", async () =>
    withDb(async (db, restart) => {
      await archive(db, [5, 6, 7, 8, 9]);
      await db.blockCertification.load();
      expect(await db.blockCertification.verifyArchive()).toBeNull();
      // An older build prunes every hot blob sidecar row at start, then its backfill writes inside the verified slots
      await db.blobSidecars.batchDelete(await db.blobSidecars.keys());
      await archive(db, [7], [7]);

      const restarted = restart().blockCertification;
      expect(await restarted.load()).toEqual({from: 5, to: 9});
      expect(await restarted.verifyArchive()).toMatchObject({slot: 7, root: block(7, true).root});
    }));

  it("verifies one block at a time outside the block cache and stops at an oversized one with its slot and root", async () =>
    withDb(async (db, restart) => {
      await archive(db, [1, 2, 3, 4, 5, 6], [4]);
      const certification = db.blockCertification;
      await certification.load();
      const stream = vi.spyOn(db.blockArchive, "binaryEntriesStream");
      const oversized = block(4, true);
      expect(await certification.verifyArchive({persistEvery: 2})).toEqual({
        slot: 4,
        root: oversized.root,
        bytes: oversized.bytes.byteLength,
      });
      expect(stream).toHaveBeenCalledWith(
        expect.objectContaining({fillCache: false, rowAtATime: true, gte: 1, lte: 6})
      );
      // The oversized block and every later slot stay unverified, across a restart too
      expect(certification.unverifiedArchive).toEqual({from: 4, to: 6});
      expect(certification.isArchiveSlotVerified(3)).toBe(true);
      expect(certification.isArchiveSlotVerified(4)).toBe(false);
      expect(await restart().blockCertification.load()).toEqual({from: 4, to: 6});

      await archive(db, [4]);
      expect(await certification.verifyArchive()).toBeNull();
      expect(certification.unverifiedArchive).toBeNull();
    }));

  it("resumes an interrupted verification from its last recorded progress", async () =>
    withDb(async (db, restart) => {
      await archive(db, [1, 2, 3, 4, 5, 6]);
      await db.blockCertification.load();
      await expect(
        db.blockCertification.verifyArchive({
          persistEvery: 2,
          onProgress: () => {
            throw Error("interrupted");
          },
        })
      ).rejects.toThrow("interrupted");

      const restarted = restart();
      const resumed = restarted.blockCertification;
      expect(await resumed.load()).toEqual({from: 3, to: 6});
      const stream = vi.spyOn(restarted.blockArchive, "binaryEntriesStream");
      expect(await resumed.verifyArchive()).toBeNull();
      expect(stream).toHaveBeenCalledWith(expect.objectContaining({gte: 3, lte: 6}));
      expect(resumed.unverifiedArchive).toBeNull();
    }));

  it("scans hot blocks one at a time outside the block cache and stops at the first oversized one", async () =>
    withDb(async (db) => {
      const small = block(3);
      await db.block.putBinary(Buffer.from(small.root.slice(2), "hex"), small.bytes);
      const stream = vi.spyOn(db.block, "binaryEntriesStream");
      expect(await db.blockCertification.scanHot()).toBeNull();
      expect(db.blockCertification.hotVerified).toBe(true);
      expect(stream).toHaveBeenCalledWith({fillCache: false, rowAtATime: true});

      const oversized = block(4, true);
      await db.block.putBinary(Buffer.from(oversized.root.slice(2), "hex"), oversized.bytes);
      expect(await db.blockCertification.scanHot()).toEqual({
        slot: 4,
        root: oversized.root,
        bytes: oversized.bytes.byteLength,
      });
      expect(db.blockCertification.hotVerified).toBe(false);
    }));

  it("leaves oversized blocks that finalization copies into the archive unverified", async () =>
    withDb(async (db, restart) => {
      const certification: ServingBlockCertification = db.blockCertification;
      expect(await certification.load()).toBeNull();
      await certification.unverifyOversized([
        {slot: 20, bytes: MAX_PAYLOAD_SIZE},
        {slot: 21, bytes: MAX_PAYLOAD_SIZE + 1},
      ]);
      expect(certification.unverifiedArchive).toEqual({from: 21, to: 21});
      await certification.unverifyOversized([{slot: 30, bytes: MAX_PAYLOAD_SIZE + 1}]);
      expect(await restart().blockCertification.load()).toEqual({from: 21, to: 30});
    }));
});
