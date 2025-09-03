import {beforeAll, afterAll, beforeEach, describe, it, expect} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {Repository, encodeKey, BUCKET_LENGTH, LevelDbController, type Db} from "../../src/index.js";

// Minimal fake SSZ-like type for string values
const fakeType = {
  serialize: (v: string): Uint8Array => Buffer.from(v, "utf8"),
  deserialize: (d: Uint8Array): string => Buffer.from(d).toString("utf8"),
  hashTreeRoot: (v: string): Uint8Array => Buffer.from("id:" + v, "utf8"),
} as any;

class TestRepository extends Repository<Uint8Array, string> {
  constructor(db: Db, bucket: number, bucketId: string) {
    super({} as any, db, bucket, fakeType, bucketId);
  }
}

describe("abstractRepository", () => {
  const bucket = 9;
  const bucketId = "repo-test-e2e";
  const dbLocation = "./.__repo_e2e_db";

  let db: LevelDbController;
  let repo: TestRepository;

  beforeAll(async () => {
    db = await LevelDbController.create({name: dbLocation}, {metrics: null, logger: getEnvLogger()});
    repo = new TestRepository(db, bucket, bucketId);
  });

  afterAll(async () => {
    await db.close();
    await LevelDbController.destroy(dbLocation);
  });

  beforeEach(async () => {
    // ensure clean DB between tests
    // LevelDbController exposes clear()
    await db.clear();
  });

  it("put/get/has/delete work end-to-end", async () => {
    const id = Buffer.from([1, 2, 3]);
    await repo.put(id, "hello");
    expect(await repo.has(id)).toBe(true);
    expect(await repo.get(id)).toBe("hello");
    const bin = await repo.getBinary(id);
    expect(Buffer.from(bin!).toString("utf8")).toBe("hello");
    await repo.delete(id);
    expect(await repo.get(id)).toBeNull();
  });

  it("add/remove uses getId via hashTreeRoot", async () => {
    const v = "value-1";
    const id = fakeType.hashTreeRoot(v) as Uint8Array;
    await repo.add(v);
    expect(await repo.get(id)).toBe(v);
    await repo.remove(v);
    expect(await repo.get(id)).toBeNull();
  });

  it("batch operations store and remove correctly", async () => {
    const a = Buffer.from([10]);
    const b = Buffer.from([11]);
    await repo.batchPut([
      {key: a, value: "a"},
      {key: b, value: "b"},
    ]);
    expect(await repo.get(a)).toBe("a");
    expect(await repo.get(b)).toBe("b");

    await repo.batchDelete([a, b]);
    expect(await repo.get(a)).toBeNull();
    expect(await repo.get(b)).toBeNull();
  });

  it("keys/values/entries and filters", async () => {
    const k10 = Buffer.from([10]);
    const k15 = Buffer.from([15]);
    const k20 = Buffer.from([20]);
    await repo.put(k10, "a");
    await repo.put(k15, "b");
    await repo.put(k20, "c");

    await expect(repo.keys()).resolves.toEqual([k10, k15, k20]);
    await expect(repo.values()).resolves.toEqual(["a", "b", "c"]);
    await expect(repo.entries()).resolves.toEqual([
      {key: k10, value: "a"},
      {key: k15, value: "b"},
      {key: k20, value: "c"},
    ]);

    await expect(repo.keys({gte: k15, lte: k20})).resolves.toEqual([k15, k20]);
    await expect(repo.values({gte: k15, lte: k20})).resolves.toEqual(["b", "c"]);
    await expect(repo.entries({reverse: true, limit: 2})).resolves.toEqual([
      {key: k20, value: "c"},
      {key: k15, value: "b"},
    ]);
  });

  it("streams yield decoded keys/values/entries", async () => {
    const a = Buffer.from([1]);
    const b = Buffer.from([2]);
    await repo.put(a, "x");
    await repo.put(b, "y");

    const keys: Uint8Array[] = [];
    for await (const k of repo.keysStream()) keys.push(k);
    expect(keys).toEqual([a, b]);

    const values: string[] = [];
    for await (const v of repo.valuesStream()) values.push(v);
    expect(values).toEqual(["x", "y"]);

    const entries: {key: Uint8Array; value: string}[] = [];
    for await (const e of repo.entriesStream()) entries.push(e);
    expect(entries).toEqual([
      {key: a, value: "x"},
      {key: b, value: "y"},
    ]);
  });

  it("binaryEntriesStream yields raw encoded keys with bucket prefix", async () => {
    const id = Buffer.from([5]);
    await repo.put(id, "z");
    const expectedEncoded = encodeKey(bucket, id);

    const aiter = repo.binaryEntriesStream()[Symbol.asyncIterator]();
    const first = await aiter.next();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!.key)).toEqual(Buffer.from(expectedEncoded));
    expect(Buffer.from(first.value!.value).toString("utf8")).toBe("z");

    // And decodeKey slices BUCKET_LENGTH
    expect(Buffer.from(first.value!.key.slice(BUCKET_LENGTH))).toEqual(id);
  });

  it("first/last helpers", async () => {
    await expect(repo.firstKey()).resolves.toBeNull();
    await expect(repo.lastKey()).resolves.toBeNull();
    await expect(repo.firstValue()).resolves.toBeNull();
    await expect(repo.lastValue()).resolves.toBeNull();
    await expect(repo.firstEntry()).resolves.toBeNull();
    await expect(repo.lastEntry()).resolves.toBeNull();

    const a = Buffer.from([1]);
    const b = Buffer.from([2]);
    await repo.put(a, "x");
    await repo.put(b, "y");

    await expect(repo.firstKey()).resolves.toEqual(a);
    await expect(repo.lastKey()).resolves.toEqual(b);
    await expect(repo.firstValue()).resolves.toBe("x");
    await expect(repo.lastValue()).resolves.toBe("y");
    await expect(repo.firstEntry()).resolves.toEqual({key: a, value: "x"});
    await expect(repo.lastEntry()).resolves.toEqual({key: b, value: "y"});
  });
});
