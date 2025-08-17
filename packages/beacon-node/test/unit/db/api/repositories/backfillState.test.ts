import {config} from "@lodestar/config/default";
import {LevelDbController} from "@lodestar/db";
import {rimraf} from "rimraf";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {BackfillState} from "../../../../../src/db/repositories/backfillState.js";
import {BACKFILL_RANGE_KEY} from "../../../../../src/db/single/backfillRange.js";
import {testLogger} from "../../../../utils/logger.js";

describe("BackfillState repository", () => {
  const testDir = "./.tmp";
  let backfillState: BackfillState;
  let db: LevelDbController;

  beforeEach(async () => {
    db = await LevelDbController.create({name: testDir}, {logger: testLogger()});
    backfillState = new BackfillState(config, db);
  });

  afterEach(async () => {
    await db.close();
    rimraf.sync(testDir);
  });

  it("should reject reserved key `BACKFILL_RANGE_KEY` insertion", () => {
    expect(() => {
      backfillState.encodeKey(BACKFILL_RANGE_KEY);
    }).toThrow("Reserved key for backfill range singleton object");
  });

  it("should encode/decode regular epoch keys correctly", () => {
    const testEpochs = [1, 2, 100, 1000];

    for (const epoch of testEpochs) {
      expect(() => {
        const encoded = backfillState.encodeKey(epoch);
        const decoded = backfillState.decodeKey(encoded);
        expect(decoded).toBe(epoch);
      }).not.toThrow();
    }
  });

  it("should nullify hasBlobs and columnIndices for pre-Deneb epochs", async () => {
    const epoch = config.DENEB_FORK_EPOCH - 1;
    const testData = {
      hasBlock: true,
      hasBlobs: true,
      columnIndices: [1, 2, 3],
    };

    await backfillState._put(epoch, testData);
    const retrieved = await backfillState._get(epoch);

    expect(retrieved).toBeDefined();
    if (retrieved) {
      expect(retrieved.hasBlock).toBe(testData.hasBlock);
      expect(retrieved.hasBlobs).toBe(null);
      expect(retrieved.columnIndices).toBe(null);
    }
  });

  it("should nullify columnIndices for post-Deneb, pre-Fulu epochs", async () => {
    const epoch = config.DENEB_FORK_EPOCH + 1;
    const testData = {
      hasBlock: true,
      hasBlobs: true,
      columnIndices: [1, 2, 3],
    };

    await backfillState._put(epoch, testData);
    const retrieved = await backfillState._get(epoch);

    expect(retrieved).toBeDefined();
    if (retrieved) {
      expect(retrieved.hasBlock).toBe(testData.hasBlock);
      expect(retrieved.hasBlobs).toBe(testData.hasBlobs);
      expect(retrieved.columnIndices).toBe(null);
    }
  });

  it("should handle columnIndices for post-Fulu epochs", async () => {
    const epoch = config.FULU_FORK_EPOCH + 1;
    const testData = {
      hasBlock: true,
      hasBlobs: true,
      columnIndices: [1, 2, 3],
    };

    await backfillState._put(epoch, testData);
    const retrieved = await backfillState._get(epoch);

    expect(retrieved).toBeDefined();
    if (retrieved) {
      expect(retrieved.hasBlock).toBe(testData.hasBlock);
      expect(retrieved.hasBlobs).toBe(testData.hasBlobs);
      expect(retrieved.columnIndices).toEqual(testData.columnIndices);
    }
  });

  it("should handle null values", async () => {
    const epoch = config.DENEB_FORK_EPOCH - 1;
    const testData = {
      hasBlock: true,
      hasBlobs: null,
      columnIndices: null,
    };

    await backfillState._put(epoch, testData);
    const retrieved = await backfillState._get(epoch);

    expect(retrieved).toBeDefined();
    if (retrieved) {
      expect(retrieved.hasBlock).toBe(testData.hasBlock);
      expect(retrieved.hasBlobs).toBe(testData.hasBlobs);
      expect(retrieved.columnIndices).toBe(testData.columnIndices);
    }
  });

  // TODO: Check wrapping logic - what actually gets written to the database
  // TODO: Check for batch insertion
});
