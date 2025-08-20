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

  it("should handle regular values", async () => {
    const epoch = config.DENEB_FORK_EPOCH - 1;
    const testData = {
      hasBlock: true,
      hasBlobs: true,
      columnIndices: [1, 2, 3],
    };

    await backfillState.put(epoch, testData);
    const retrieved = await backfillState.get(epoch);

    expect(retrieved).toEqual(testData);
  });

  it("should handle null values", async () => {
    const epoch = config.DENEB_FORK_EPOCH - 1;
    const testData = {
      hasBlock: true,
      hasBlobs: null,
      columnIndices: null,
    };

    await backfillState.put(epoch, testData);
    const retrieved = await backfillState.get(epoch);

    expect(retrieved).toEqual(testData);
  });

  it("should handle batch of values", async () => {
    const epoch = config.DENEB_FORK_EPOCH - 1;
    const testData = [
      {key: epoch, value: {hasBlock: true, hasBlobs: true, columnIndices: [1, 2, 3]}},
      {key: epoch + 1, value: {hasBlock: true, hasBlobs: null, columnIndices: null}},
      {key: epoch + 2, value: {hasBlock: false, hasBlobs: false, columnIndices: []}},
    ];

    await backfillState.batchPut(testData);
    const retrievedData = [];
    for (const element of testData) {
      const retrievedValue = await backfillState.get(element.key);
      retrievedData.push({key: element.key, value: retrievedValue});
    }

    expect(retrievedData).toEqual(testData);
  });
});
