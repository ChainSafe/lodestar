/** biome-ignore-all lint/style/noNonNullAssertion: values all exist */
import {beforeAll, afterAll, beforeEach, describe, it, expect} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {PrefixedRepository, LevelDbController, type Db} from "../../src/index.js";

// Fake SSZ-like Type for string values
const fakeType = {
  serialize: (v: string): Uint8Array => Buffer.from(v, "utf8"),
  deserialize: (d: Uint8Array): string => Buffer.from(d).toString("utf8"),
  hashTreeRoot: (v: string): Uint8Array => Buffer.from("id:" + v, "utf8"),
} as any;

// P = number (single-byte prefix), I = Uint8Array id (raw bytes)
class TestPrefixedRepository extends PrefixedRepository<number, Uint8Array, string> {
  constructor(db: Db, bucket: number, bucketId: string) {
    super({} as any, db, bucket, fakeType, bucketId);
  }

  encodeKeyRaw(prefix: number, id: Uint8Array): Uint8Array {
    return Buffer.concat([Buffer.from([prefix]), Buffer.from(id)]);
  }

  decodeKeyRaw(raw: Uint8Array): {prefix: number; id: Uint8Array} {
    return {prefix: raw[0], id: raw.slice(1)};
  }

  getMaxKeyRaw(prefix: number): Uint8Array {
    return Buffer.from([prefix, 0xff]);
  }

  getMinKeyRaw(prefix: number): Uint8Array {
    return Buffer.from([prefix, 0x00]);
  }
}

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
    const value = "hello";
    await repo.put(p, value);
    const id = repo.getId(value);
    expect(await repo.get(p, id)).toBe(value);
    const bin = await repo.getBinary(p, id);
    expect(Buffer.from(bin!).toString("utf8")).toBe(value);
    await repo.delete(p, id);
    expect(await repo.get(p, id)).toBeNull();
  });

  it("getMany and getManyBinary in order and with missing ids", async () => {
    const p = 3;
    const v1 = "a";
    const v2 = "b";
    await repo.put(p, v1);
    await repo.put(p, v2);
    const id1 = repo.getId(v1);
    const id2 = repo.getId(v2);
    const idMissing = Buffer.from([0x99]);

    await expect(repo.getMany(p, [id1, id2, idMissing])).resolves.toEqual([v1, v2, undefined]);
    const resBin = await repo.getManyBinary(p, [id1, id2, idMissing]);
    expect(resBin.map((b) => (b ? Buffer.from(b).toString("utf8") : undefined))).toEqual([v1, v2, undefined]);
  });

  it("putMany and putManyBinary store correctly", async () => {
    const p = 4;
    await repo.putMany(p, ["x", "y"]);
    const idX = repo.getId("x");
    const idY = repo.getId("y");
    expect(await repo.get(p, idX)).toBe("x");
    expect(await repo.get(p, idY)).toBe("y");

    const p2 = 5;
    const idA = Buffer.from([0x2a]);
    const idB = Buffer.from([0x2b]);
    await repo.putManyBinary(p2, [
      {key: idA, value: Buffer.from("A")},
      {key: idB, value: Buffer.from("B")},
    ]);
    expect(await repo.get(p2, idA)).toBe("A");
    expect(await repo.get(p2, idB)).toBe("B");
  });

  it("values and valuesStream for single and multiple prefixes", async () => {
    const p1 = 7;
    const p2 = 8;
    await repo.put(p1, "p1-1");
    await repo.put(p1, "p1-2");
    await repo.put(p2, "p2-1");

    // Single prefix
    await expect(repo.values(p1)).resolves.toEqual(["p1-1", "p1-2"]);

    // Multiple prefixes preserve provided order
    await expect(repo.values([p2, p1])).resolves.toEqual(["p2-1", "p1-1", "p1-2"]);

    const fromStream: string[] = [];
    for await (const v of repo.valuesStream([p2, p1])) fromStream.push(v);
    expect(fromStream).toEqual(["p2-1", "p1-1", "p1-2"]);
  });

  it("valuesStreamBinary and valuesBinary decode prefix and id", async () => {
    const p = 10;
    const id1 = Buffer.from([0x01]);
    const id2 = Buffer.from([0x02]);
    await repo.putManyBinary(p, [
      {key: id1, value: Buffer.from("v1")},
      {key: id2, value: Buffer.from("v2")},
    ]);

    const list = await repo.valuesBinary(p);
    expect(list.map((e) => ({p: e.prefix, id: Buffer.from(e.id), v: Buffer.from(e.value).toString("utf8")}))).toEqual([
      {p: p, id: id1, v: "v1"},
      {p: p, id: id2, v: "v2"},
    ]);

    const fromStream: {prefix: number; id: Uint8Array; value: Uint8Array}[] = [];
    for await (const e of repo.valuesStreamBinary(p)) fromStream.push(e);
    expect(
      fromStream.map((e) => ({p: e.prefix, id: Buffer.from(e.id), v: Buffer.from(e.value).toString("utf8")}))
    ).toEqual([
      {p: p, id: id1, v: "v1"},
      {p: p, id: id2, v: "v2"},
    ]);
  });

  it("entriesStream and entriesStreamBinary provide decoded data", async () => {
    const p = 11;
    await repo.put(p, "a");
    await repo.put(p, "b");
    const idA = repo.getId("a");
    const idB = repo.getId("b");

    const entries: {prefix: number; id: Uint8Array; value: string}[] = [];
    for await (const e of repo.entriesStream(p)) entries.push(e);
    expect(entries).toEqual([
      {prefix: p, id: idA, value: "a"},
      {prefix: p, id: idB, value: "b"},
    ]);

    const entriesBin: {prefix: number; id: Uint8Array; value: Uint8Array}[] = [];
    for await (const e of repo.entriesStreamBinary(p)) entriesBin.push(e);
    expect(
      entriesBin.map((e) => ({prefix: e.prefix, id: Buffer.from(e.id), value: Buffer.from(e.value).toString("utf8")}))
    ).toEqual([
      {prefix: p, id: idA, value: "a"},
      {prefix: p, id: idB, value: "b"},
    ]);
  });

  it("deleteMany removes all for provided prefixes", async () => {
    const p1 = 20;
    const p2 = 21;
    await repo.put(p1, "a");
    await repo.put(p1, "b");
    await repo.put(p2, "c");

    await repo.deleteMany(p1);
    await expect(repo.values(p1)).resolves.toEqual([]);
    await expect(repo.values(p2)).resolves.toEqual(["c"]);

    // Re-fill and delete both
    await repo.put(p1, "a");
    await repo.put(p1, "b");
    await repo.put(p2, "c");
    await repo.deleteMany([p1, p2]);
    await expect(repo.values([p1, p2])).resolves.toEqual([]);
  });

  it("keys returns decoded prefix+id with filters and options", async () => {
    const p1 = 30;
    const p2 = 31;
    const id1 = Buffer.from([0x01]);
    const id2 = Buffer.from([0x02]);
    const id3 = Buffer.from([0x03]);

    await repo.putManyBinary(p1, [
      {key: id1, value: Buffer.from("v1")},
      {key: id2, value: Buffer.from("v2")},
      {key: id3, value: Buffer.from("v3")},
    ]);
    await repo.putManyBinary(p2, [{key: Buffer.from([0x01]), value: Buffer.from("w1")}]);

    const gte = repo.encodeKeyRaw(p1, Buffer.from([0x00]));
    const lte = repo.encodeKeyRaw(p1, Buffer.from([0xff]));
    const keys = await repo.keys({gte, lte});
    expect(keys).toEqual([
      {prefix: p1, id: id1},
      {prefix: p1, id: id2},
      {prefix: p1, id: id3},
    ]);

    const revLimit = await repo.keys({gte, lte, reverse: true, limit: 2});
    expect(revLimit).toEqual([
      {prefix: p1, id: id3},
      {prefix: p1, id: id2},
    ]);
  });
});
