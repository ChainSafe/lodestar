import {execSync} from "node:child_process";
import {expect} from "chai";
import leveldown from "leveldown";
import all from "it-all";
import {LevelDbController} from "../../../src/controller/index.js";
import {testLogger} from "../../utils/logger.js";

describe("LevelDB controller", () => {
  const dbLocation = "./.__testdb";
  const db = new LevelDbController({name: dbLocation}, {metrics: null, logger: testLogger()});

  before(async () => {
    await db.start();
  });

  after(async () => {
    await db.stop();
    await new Promise<void>((resolve, reject) => {
      leveldown.destroy(dbLocation, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  it("test get not found", async () => {
    const key = Buffer.from("not-existing-key");
    expect(await db.get(key)).to.equal(null);
  });

  it("test put/get/delete", async () => {
    const key = Buffer.from("test");
    const value = Buffer.from("some value");
    await db.put(key, value);
    expect(await db.get(key)).to.be.deep.equal(value);
    await db.delete(key);
    expect(await db.get(key)).to.equal(null);
  });

  it("test batchPut", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value"),
      },
      {
        key: k2,
        value: Buffer.from("value"),
      },
    ]);
    expect(await db.get(k1)).to.not.be.null;
    expect(await db.get(k2)).to.not.be.null;
  });

  it("test batch delete", async () => {
    await db.batchDelete(await db.keys());
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value"),
      },
      {
        key: k2,
        value: Buffer.from("value"),
      },
    ]);
    expect((await db.entries()).length).to.equal(2);
    await db.batchDelete([k1, k2]);
    expect((await db.entries()).length).to.equal(0);
  });

  it("test entries", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value"),
      },
      {
        key: k2,
        value: Buffer.from("value"),
      },
    ]);
    const result = await db.entries({
      gte: k1,
      lte: k2,
    });
    expect(result.length).to.be.equal(2);
  });

  it("test entriesStream", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value"),
      },
      {
        key: k2,
        value: Buffer.from("value"),
      },
    ]);
    const resultStream = db.entriesStream({
      gte: k1,
      lte: k2,
    });
    const result = await all(resultStream);
    expect(result.length).to.be.equal(2);
  });

  it("test compactRange + approximateSize", async () => {
    const indexes = Array.from({length: 100}, (_, i) => i);
    const keys = indexes.map((i) => Buffer.from([i]));
    const values = indexes.map((i) => Buffer.alloc(1000, i));
    const minKey = Buffer.from([0x00]);
    const maxKey = Buffer.from([0xff]);

    await db.batchPut(keys.map((key, i) => ({key, value: values[i]})));
    await db.batchDelete(keys);

    const sizeBeforeCompact = getDbSize();
    await db.compactRange(minKey, maxKey);
    const sizeAfterCompact = getDbSize();

    expect(sizeAfterCompact).lt(sizeBeforeCompact, "Expected sizeAfterCompact < sizeBeforeCompact");

    // approximateSize is not exact, just test a number is positive
    const approxSize = await db.approximateSize(minKey, maxKey);
    expect(approxSize).gt(0, "approximateSize return not > 0");
  });

  function getDbSize(): number {
    // 116	./.__testdb
    const res = execSync(`du -bs ${dbLocation}`, {encoding: "utf8"});
    const match = res.match(/^(\d+)/);
    if (!match) throw Error(`Unknown du response \n${res}`);
    return parseInt(match[1]);
  }
});
