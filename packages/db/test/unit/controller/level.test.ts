import {expect} from "chai";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import leveldown from "leveldown";
import all from "it-all";
import {LevelDbController} from "../../../src/controller/index.js";

describe("LevelDB controller", () => {
  const dbLocation = "./.__testdb";
  const db = new LevelDbController({name: dbLocation}, {logger: new WinstonLogger()});

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

  it("test put/get/delete", async () => {
    const key = Buffer.from("test");
    const value = Buffer.from("some value");
    await db.put(key, value);
    expect(await db.get(key)).to.be.deep.equal(value);
    await db.delete(key);
    expect(await db.get(key)).to.be.null;
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
});
