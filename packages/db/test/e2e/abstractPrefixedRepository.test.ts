/** biome-ignore-all lint/style/noNonNullAssertion: values all exist */

import {afterAll, beforeAll, beforeEach, describe, expect, it} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {fromAsync} from "@lodestar/utils";
import {
  type Db,
  LevelDbController,
  PrefixedRepository,
  decodeNumberForDbKey,
  encodeNumberForDbKey,
} from "../../src/index.js";

type Slot = number;
type Column = number;

type TestPrefixedType = {column: Column; value: string};

// Fake SSZ-like Type for string values
const testPrefixedType = {
  serialize: (v: TestPrefixedType): Uint8Array => Buffer.from(JSON.stringify(v), "utf8"),
  deserialize: (d: Uint8Array): TestPrefixedType => JSON.parse(Buffer.from(d).toString("utf8")) as TestPrefixedType,
  hashTreeRoot: (v: string): Uint8Array => Buffer.from("id:" + v, "utf8"),
} as any;

// P = number (single-byte prefix), I = Uint8Array id (raw bytes)
class TestPrefixedRepository extends PrefixedRepository<Slot, Column, TestPrefixedType> {
  constructor(db: Db, bucket: number, bucketId: string) {
    super({} as any, db, bucket, testPrefixedType, bucketId);
  }

  encodeKeyRaw(prefix: number, id: number): Uint8Array {
    return Buffer.concat([encodeNumberForDbKey(prefix, 2), encodeNumberForDbKey(id, 2)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: number; id: number} {
    return {prefix: decodeNumberForDbKey(raw, 2), id: decodeNumberForDbKey(raw.slice(2), 2)};
  }

  getMaxKeyRaw(prefix: number): Uint8Array {
    return Buffer.concat([encodeNumberForDbKey(prefix, 2), encodeNumberForDbKey(0xffff, 2)]);
  }

  getMinKeyRaw(prefix: number): Uint8Array {
    return Buffer.concat([encodeNumberForDbKey(prefix, 2), encodeNumberForDbKey(0, 2)]);
  }

  getId(value: TestPrefixedType): number {
    return value.column;
  }
}

const numberOfSlots = 50;

// We need to store columns which are more than 1 byte to test the proper encoding
const numberOfColumns = 300;

const generateColumnsData = (slot: Slot) =>
  Array.from({length: numberOfColumns}, (_, c) => ({column: c, value: `s:${slot}-c:${c}`}));

// Generate fixtures to be used later with the db
const testData: Record<Slot, TestPrefixedType[]> = Array.from({length: numberOfSlots}, (_, s) =>
  generateColumnsData(s)
);

describe("abstractPrefixedRepository", () => {
  const bucket = 12;
  const bucketId = "prefixed-repo-e2e";
  const dbLocation = "./.__prefixed_repo_e2e_db";

  let db: LevelDbController;
  let repo: TestPrefixedRepository;

  beforeAll(async () => {
    db = await LevelDbController.create({name: dbLocation}, {metrics: null, logger: getEnvLogger()});
    repo = new TestPrefixedRepository(db, bucket, bucketId);
  });

  afterAll(async () => {
    await db.close();
    await LevelDbController.destroy(dbLocation);
  });

  beforeEach(async () => {
    await db.clear();
  });

  it("put/get/getBinary/delete per prefix", async () => {
    const p = 1;
    const id = 0;
    const value = testData[p][id];

    // Put
    await expect(repo.put(p, value)).resolves.toBeUndefined();

    // Get
    expect(await repo.get(p, id)).toEqual(value);

    // Get Binary
    const bin = await repo.getBinary(p, id);
    expect(testPrefixedType.deserialize(bin)).toEqual(value);

    // Delete
    await repo.delete(p, id);
    expect(await repo.get(p, id)).toBeNull();
  });

  it("getMany and getManyBinary in order and with missing ids", async () => {
    const p = 3;
    const ids = [0, 10, 4, 20];
    const values = [testData[p][0], testData[p][10], testData[p][4], testData[p][20]];
    const valuesBinaries = values.map((v) => testPrefixedType.serialize(v));

    for (const v of values) {
      await repo.put(p, v);
    }

    const result = await repo.getMany(p, ids);

    expect(result).toHaveLength(ids.length);
    expect(result).toEqual(values);

    const resultBinary = await repo.getManyBinary(p, ids);

    expect(resultBinary).toHaveLength(ids.length);
    expect(resultBinary).toEqual(valuesBinaries);
  });

  it("putMany store correctly", async () => {
    const p = 3;
    const ids = [0, 10, 4, 20];
    const values = [testData[p][0], testData[p][10], testData[p][4], testData[p][20]];

    await repo.putMany(p, values);

    for (const [index, id] of ids.entries()) {
      await expect(repo.get(p, id)).resolves.toEqual(values[index]);
    }
  });

  it("putManyBinary store correctly", async () => {
    const p = 3;
    const ids = [0, 10, 4, 20];
    const values = [testData[p][0], testData[p][10], testData[p][4], testData[p][20]];
    const valuesBinaries = values.map((v) => ({key: v.column, value: testPrefixedType.serialize(v)}));

    await repo.putManyBinary(p, valuesBinaries);

    for (const [index, id] of ids.entries()) {
      await expect(repo.get(p, id)).resolves.toEqual(values[index]);
    }
  });

  it("deleteMany removes all for provided prefixes", async () => {
    const p1 = 20;
    const p2 = 21;
    // Put two columns for slot 20
    await repo.put(p1, testData[p1][1]);
    await repo.put(p1, testData[p1][2]);

    // Put two columns for slot 21
    await repo.put(p2, testData[p2][1]);
    await repo.put(p2, testData[p2][2]);

    await repo.deleteMany(p1);
    await expect(fromAsync(repo.valuesStream(p1))).resolves.toEqual([]);
    await expect(fromAsync(repo.valuesStream(p2))).resolves.toEqual([testData[p2][1], testData[p2][2]]);

    // Re-fill and delete both
    await repo.put(p1, testData[p1][1]);
    await repo.put(p1, testData[p1][2]);
    await repo.put(p2, testData[p2][1]);
    await repo.put(p2, testData[p2][2]);

    await repo.deleteMany([p1, p2]);
    await expect(fromAsync(repo.valuesStream(p1))).resolves.toEqual([]);
    await expect(fromAsync(repo.valuesStream(p2))).resolves.toEqual([]);
  });

  it("batch mixes put and del operations within a prefix", async () => {
    const prefix = 40;
    const col1 = testData[prefix][1];
    const col2 = testData[prefix][2];
    const col3 = testData[prefix][3];

    // Setup initial state
    await repo.put(prefix, col1);
    await repo.put(prefix, col2);
    expect(await repo.get(prefix, col1.column)).toEqual(col1);
    expect(await repo.get(prefix, col2.column)).toEqual(col2);
    expect(await repo.get(prefix, col3.column)).toBeNull();

    // Mix put and del in a single batch
    await repo.batch(prefix, [
      {type: "del", key: col1.column},
      {type: "put", key: col3.column, value: col3},
      {type: "del", key: col2.column},
    ]);

    expect(await repo.get(prefix, col1.column)).toBeNull();
    expect(await repo.get(prefix, col2.column)).toBeNull();
    expect(await repo.get(prefix, col3.column)).toEqual(col3);
  });

  it("batchBinary stores raw Uint8Array values without encoding", async () => {
    const prefix = 41;
    const id1 = 100;
    const id2 = 101;
    const rawValue1 = Buffer.from("raw-binary-1", "utf8");
    const rawValue2 = Buffer.from("raw-binary-2", "utf8");

    await repo.batchBinary(prefix, [
      {type: "put", key: id1, value: rawValue1},
      {type: "put", key: id2, value: rawValue2},
    ]);

    // Values should be stored as-is (raw), not encoded via the type serializer
    const binA = await repo.getBinary(prefix, id1);
    const binB = await repo.getBinary(prefix, id2);
    expect(Buffer.from(binA!)).toEqual(rawValue1);
    expect(Buffer.from(binB!)).toEqual(rawValue2);

    // batchBinary can also delete
    await repo.batchBinary(prefix, [{type: "del", key: id1}]);
    expect(await repo.getBinary(prefix, id1)).toBeNull();
    expect(await repo.getBinary(prefix, id2)).not.toBeNull();
  });

  describe("valuesStream,valuesStreamBinary,entriesStream,entriesStreamBinary", () => {
    it("valuesStream should fetch for single and multiple prefixes", async () => {
      const p1 = 7;
      const p2 = 8;

      await repo.putMany(p1, testData[p1]);
      await repo.putMany(p2, testData[p2]);

      // Single prefix
      const result1 = await fromAsync(repo.valuesStream(p1));

      expect(result1).toHaveLength(numberOfColumns);
      // For this test we don't emphasis on the order
      expect(result1.sort((r1, r2) => r1.column - r2.column)).toEqual(testData[p1]);

      // Multiple prefix
      const result2 = await fromAsync(repo.valuesStream([p1, p2]));

      // For this test we don't emphasis on the order
      expect(result2).toHaveLength(numberOfColumns * 2);
      expect(result2.sort((r1, r2) => r1.column - r2.column)).toEqual(
        [...testData[p1], ...testData[p2]].sort((r1, r2) => r1.column - r2.column)
      );
    });

    it("valuesStreamBinary should fetch for single and multiple prefixes", async () => {
      const p1 = 7;
      const dataBinaryP1 = testData[p1].map((c) => ({id: c.column, prefix: p1, value: testPrefixedType.serialize(c)}));
      const p2 = 8;
      const dataBinaryP2 = testData[p2].map((c) => ({id: c.column, prefix: p2, value: testPrefixedType.serialize(c)}));

      await repo.putMany(p1, testData[p1]);
      await repo.putMany(p2, testData[p2]);

      // Single prefix
      const result1 = await fromAsync(repo.valuesStreamBinary(p1));

      expect(result1).toHaveLength(numberOfColumns);
      // For this test we don't emphasis on the order
      expect(result1.sort((r1, r2) => r1.id - r2.id)).toEqual(dataBinaryP1);

      // Multiple prefix
      const result2 = await fromAsync(repo.valuesStreamBinary([p1, p2]));

      // For this test we don't emphasis on the order
      expect(result2).toHaveLength(numberOfColumns * 2);
      expect(result2.sort((r1, r2) => r1.id - r2.id)).toEqual(
        [...dataBinaryP1, ...dataBinaryP2].sort((r1, r2) => r1.id - r2.id)
      );
    });

    it("entriesStream should fetch for single and multiple prefixes", async () => {
      const p1 = 7;
      const entriesDataP1 = testData[p1].map((c) => ({id: c.column, prefix: p1, value: c}));
      const p2 = 8;
      const entriesDataP2 = testData[p2].map((c) => ({id: c.column, prefix: p2, value: c}));

      await repo.putMany(p1, testData[p1]);
      await repo.putMany(p2, testData[p2]);

      // Single prefix
      const result1 = await fromAsync(repo.entriesStream(p1));

      expect(result1).toHaveLength(numberOfColumns);
      // For this test we don't emphasis on the order
      expect(result1.sort((r1, r2) => r1.id - r2.id)).toEqual(entriesDataP1);

      // Multiple prefix
      const result2 = await fromAsync(repo.entriesStream([p1, p2]));

      // For this test we don't emphasis on the order
      expect(result2).toHaveLength(numberOfColumns * 2);
      expect(result2.sort((r1, r2) => r1.id - r2.id)).toEqual(
        [...entriesDataP1, ...entriesDataP2].sort((r1, r2) => r1.id - r2.id)
      );
    });

    it("entriesStreamBinary should fetch for single and multiple prefixes", async () => {
      const p1 = 7;
      const entriesDataP1 = testData[p1].map((c) => ({id: c.column, prefix: p1, value: testPrefixedType.serialize(c)}));
      const p2 = 8;
      const entriesDataP2 = testData[p2].map((c) => ({id: c.column, prefix: p2, value: testPrefixedType.serialize(c)}));

      await repo.putMany(p1, testData[p1]);
      await repo.putMany(p2, testData[p2]);

      // Single prefix
      const result1 = await fromAsync(repo.entriesStreamBinary(p1));

      expect(result1).toHaveLength(numberOfColumns);
      // For this test we don't emphasis on the order
      expect(result1.sort((r1, r2) => r1.id - r2.id)).toEqual(entriesDataP1);

      // Multiple prefix
      const result2 = await fromAsync(repo.entriesStreamBinary([p1, p2]));

      // For this test we don't emphasis on the order
      expect(result2).toHaveLength(numberOfColumns * 2);
      expect(result2.sort((r1, r2) => r1.id - r2.id)).toEqual(
        [...entriesDataP1, ...entriesDataP2].sort((r1, r2) => r1.id - r2.id)
      );
    });

    it("values should return in correct order of id for single prefix", async () => {
      const p1 = 7;
      const valuesP1 = [testData[p1][10], testData[p1][11], testData[p1][12]];
      await repo.putMany(p1, valuesP1);

      const result1 = await fromAsync(repo.valuesStream(p1));

      expect(result1.map((v) => v.column)).toEqual([10, 11, 12]);
    });

    it("values should return in correct order of id for multiple prefixes", async () => {
      const p1 = 7;
      const valuesP1 = [testData[p1][10], testData[p1][11], testData[p1][12]];
      const p2 = 10;
      const valuesP2 = [testData[p2][9], testData[p2][19], testData[p2][21]];

      await repo.putMany(p1, valuesP1);
      await repo.putMany(p2, valuesP2);

      const result1 = await fromAsync(repo.valuesStream([p1, p2]));

      expect(result1.map((v) => v.column)).toEqual([10, 11, 12, 9, 19, 21]);
    });
  });

  describe("keys", () => {
    const getRangeDataInclusive = (slot: number, start: number, end: number) =>
      Array.from({length: end - start + 1}, (_, index) => ({id: start + index, prefix: slot}));

    it("keys returns decoded prefix+id with filters and options", async () => {
      const slot1 = 30;
      const slot2 = 31;
      const column1 = 15;
      const column2 = 258;
      const column3 = 289;

      await repo.putMany(slot1, [testData[slot1][column1], testData[slot1][column2], testData[slot1][column3]]);
      await repo.putMany(slot2, [testData[slot2][column1], testData[slot2][column2], testData[slot2][column3]]);

      const gte = {prefix: slot1, id: 0};
      const lte = {prefix: slot1, id: 400};
      const keys = await repo.keys({gte, lte});

      expect(keys).toEqual([
        {prefix: slot1, id: column1},
        {prefix: slot1, id: column2},
        {prefix: slot1, id: column3},
      ]);

      const revLimit = await repo.keys({gte, lte, reverse: true, limit: 2});
      expect(revLimit).toEqual([
        {prefix: slot1, id: column3},
        {prefix: slot1, id: column2},
      ]);
    });

    it("should fetch correct range across single prefix", async () => {
      const slot1 = 30;
      const slot2 = 48;
      const getRangeDataInclusive = (slot: number, start: number, end: number) =>
        Array.from({length: end - start + 1}, (_, index) => ({id: start + index, prefix: slot}));

      await repo.putMany(slot1, testData[slot1]);
      await repo.putMany(slot2, testData[slot2]);

      // Across single byte
      const result1 = await repo.keys({gt: {prefix: slot1, id: 5}, lt: {prefix: slot1, id: 17}});
      expect(result1).toEqual(getRangeDataInclusive(slot1, 6, 16));

      // Across higher byte
      const result2 = await repo.keys({gt: {prefix: slot1, id: 257}, lt: {prefix: slot1, id: 266}});
      expect(result2).toEqual(getRangeDataInclusive(slot1, 258, 265));

      // Across multiple byte
      const result3 = await repo.keys({gt: {prefix: slot1, id: 17}, lt: {prefix: slot1, id: 275}});
      expect(result3).toEqual(getRangeDataInclusive(slot1, 18, 274));
    });

    it("should fetch correct range across multiple prefix", async () => {
      const slot1 = 30;
      const slot2 = 31;
      const slot3 = 32;

      await repo.putMany(slot1, testData[slot1]);
      await repo.putMany(slot2, testData[slot2]);
      await repo.putMany(slot3, testData[slot3]);

      const query = {gt: {prefix: slot1, id: 5}, lt: {prefix: slot3, id: 17}};
      const result = [
        ...getRangeDataInclusive(slot1, 6, 299),
        ...getRangeDataInclusive(slot2, 0, 299),
        ...getRangeDataInclusive(slot3, 0, 16),
      ].sort((a, b) => a.id - b.id);

      const result1 = await repo.keys(query);
      expect(result1.sort((r1, r2) => r1.id - r2.id)).toEqual(result);
    });

    it("should fetch keys in correct order", async () => {
      const slot = 30;

      await repo.putMany(slot, testData[slot]);

      const gte = {prefix: slot, id: 19};
      const lte = {prefix: slot, id: 23};
      const keys = await repo.keys({gte, lte});

      expect(keys).toEqual([
        {prefix: slot, id: 19},
        {prefix: slot, id: 20},
        {prefix: slot, id: 21},
        {prefix: slot, id: 22},
        {prefix: slot, id: 23},
      ]);
    });

    it("should fetch keys in correct order across multiple prefixes", async () => {
      const slot1 = 30;
      const slot2 = 31;
      await repo.putMany(slot1, testData[slot1]);
      await repo.putMany(slot2, testData[slot2]);

      const query = {gt: {prefix: slot1, id: 295}, lt: {prefix: slot2, id: 4}};

      const keys = await repo.keys(query);

      expect(keys).toEqual([
        {prefix: slot1, id: 296},
        {prefix: slot1, id: 297},
        {prefix: slot1, id: 298},
        {prefix: slot1, id: 299},
        {prefix: slot2, id: 0},
        {prefix: slot2, id: 1},
        {prefix: slot2, id: 2},
        {prefix: slot2, id: 3},
      ]);
    });

    it("should not cross the bucket boundary towards lower bucket", async () => {
      const repo2 = new TestPrefixedRepository(db, bucket - 1, bucketId);
      const slot = 30;
      await repo.putMany(slot, testData[slot]);
      await repo2.putMany(slot, testData[slot]);

      const query = {lt: {prefix: slot, id: 4}};

      const keys = await repo.keys(query);

      expect(keys).toEqual([
        {prefix: slot, id: 0},
        {prefix: slot, id: 1},
        {prefix: slot, id: 2},
        {prefix: slot, id: 3},
      ]);
    });

    it("should not cross the bucket boundary towards higher bucket", async () => {
      const repo2 = new TestPrefixedRepository(db, bucket + 1, bucketId);
      const slot = 30;
      await repo.putMany(slot, testData[slot]);
      await repo2.putMany(slot, testData[slot]);

      const query = {gt: {prefix: slot, id: 295}};

      const keys = await repo.keys(query);

      expect(keys).toEqual([
        {prefix: slot, id: 296},
        {prefix: slot, id: 297},
        {prefix: slot, id: 298},
        {prefix: slot, id: 299},
      ]);
    });

    it("should not cross the bucket boundary with multiple prefixes", async () => {
      const repo2 = new TestPrefixedRepository(db, bucket - 1, bucketId);
      const slot1 = 30;
      const slot2 = 31;
      await repo.putMany(slot1, testData[slot1]);
      await repo2.putMany(slot1, testData[slot1]);

      await repo.putMany(slot2, testData[slot2]);
      await repo2.putMany(slot2, testData[slot2]);

      const query = {lt: {prefix: slot2, id: 4}};

      const keys = await repo.keys(query);

      expect(keys).toEqual([...getRangeDataInclusive(slot1, 0, 299), ...getRangeDataInclusive(slot2, 0, 3)]);
    });
  });
});
