import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {LevelDbController} from "@lodestar/db/controller/level";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {BlockBySlotRepository} from "../../../src/slashingProtection/block/index.js";
import {InvalidBlockErrorCode, SlashingProtection} from "../../../src/slashingProtection/index.js";
import {testLogger} from "../../utils/logger.js";

describe("SlashingProtection concurrent block proposals", () => {
  const pubkey = ssz.BLSPubkey.defaultValue();
  const block = {slot: 32, signingRoot: Buffer.alloc(32, 1)};
  const conflict = {slot: 32, signingRoot: Buffer.alloc(32, 2)};
  let dbLocation: string;
  let db: LevelDbController;
  let slashingProtection: SlashingProtection;
  let blocks: BlockBySlotRepository;

  beforeEach(async () => {
    dbLocation = fs.mkdtempSync(path.join(os.tmpdir(), "lodestar-block-slashing-protection-"));
    db = await LevelDbController.create({name: dbLocation}, {logger: testLogger()});
    slashingProtection = new SlashingProtection(db);
    blocks = new BlockBySlotRepository(db);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    fs.rmSync(dbLocation, {recursive: true, force: true});
  });

  it("rejects concurrent conflicting proposals for the same public key bytes", async () => {
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertBlockProposal(pubkey, block),
      slashingProtection.checkAndInsertBlockProposal(Uint8Array.from(pubkey), conflict),
    ]);

    expect(results).toMatchObject([
      {status: "fulfilled"},
      {status: "rejected", reason: {type: {code: InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL}}},
    ]);
    expect(await blocks.getAll(pubkey)).toEqual([block]);
  });

  it("accepts concurrent repeat signing of the same block", async () => {
    await Promise.all([
      slashingProtection.checkAndInsertBlockProposal(pubkey, block),
      slashingProtection.checkAndInsertBlockProposal(pubkey, block),
    ]);

    expect(await blocks.getAll(pubkey)).toEqual([block]);
  });

  it("enforces the lower bound across concurrent proposals for different slots", async () => {
    const earlierBlock = {...block, slot: 31};
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertBlockProposal(pubkey, block),
      slashingProtection.checkAndInsertBlockProposal(pubkey, earlierBlock),
    ]);

    expect(results).toMatchObject([
      {status: "fulfilled"},
      {status: "rejected", reason: {type: {code: InvalidBlockErrorCode.SLOT_LESS_THAN_LOWER_BOUND}}},
    ]);
    expect(await blocks.getAll(pubkey)).toEqual([block]);
  });

  it("continues queued checks after a conflicting proposal is rejected", async () => {
    await slashingProtection.checkAndInsertBlockProposal(pubkey, block);
    const nextBlock = {...block, slot: 33};
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertBlockProposal(pubkey, conflict),
      slashingProtection.checkAndInsertBlockProposal(pubkey, nextBlock),
    ]);

    expect(results).toMatchObject([
      {status: "rejected", reason: {type: {code: InvalidBlockErrorCode.DOUBLE_BLOCK_PROPOSAL}}},
      {status: "fulfilled"},
    ]);
    expect(await blocks.getAll(pubkey)).toEqual([block, nextBlock]);
  });

  it("continues queued checks after a database write fails", async () => {
    const writeError = new Error("database write failed");
    vi.spyOn(db, "batchPut").mockRejectedValueOnce(writeError);
    const results = await Promise.allSettled([
      slashingProtection.checkAndInsertBlockProposal(pubkey, block),
      slashingProtection.checkAndInsertBlockProposal(pubkey, conflict),
    ]);

    expect(results).toEqual([
      {status: "rejected", reason: writeError},
      {status: "fulfilled", value: undefined},
    ]);
    expect(await blocks.getAll(pubkey)).toEqual([conflict]);
  });

  it("does not block other validators while a write is pending", async () => {
    const started = defer<void>();
    const release = defer<void>();
    const batchPut = db.batchPut.bind(db);
    vi.spyOn(db, "batchPut").mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      await batchPut(...args);
    });
    const pending = slashingProtection.checkAndInsertBlockProposal(pubkey, block);

    try {
      await started.promise;
      const otherPubkey = Buffer.alloc(48, 1);
      await slashingProtection.checkAndInsertBlockProposal(otherPubkey, conflict);
      expect(await blocks.getAll(otherPubkey)).toEqual([conflict]);
    } finally {
      release.resolve();
      await pending;
    }
  });
});
