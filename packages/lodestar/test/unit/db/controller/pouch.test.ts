import {assert, expect} from "chai";
import {PouchDbController} from "../../../../src/db/controller";

describe("PouchDB controller", () => {
  const db = new PouchDbController({name: 'testDb'});

  before(async () => {
    await db.start();
  });

  after(async () => {
    await db.stop();
  });

  it("test put/get/delete", async () => {
    const key = Buffer.from("test");
    const value = Buffer.from("some value");
    await db.put(key, value);
    expect(await db.get(key)).to.deep.equal(value);
    await db.delete(key);
    expect(await db.get(key)).to.be.null;
  });

  it("test batchPut", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value")
      },
      {
        key: k2,
        value: Buffer.from("value")
      },
    ]);
    expect(await db.get(k1)).to.not.be.null;
    expect(await db.get(k2)).to.not.be.null;
  });

  it("test batch delete", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value")
      },
      {
        key: k2,
        value: Buffer.from("value")
      },
    ]);
    expect((await db.entries()).length).to.be.equal(2);
    await db.batchDelete([k1, k2]);
    //await db.batchDelete([k1, k2]);

    expect((await db.entries()).length).to.be.equal(0);
  });

  it("test entries", async () => {
    const k1 = Buffer.from("test1");
    const k2 = Buffer.from("test2");
    await db.batchPut([
      {
        key: k1,
        value: Buffer.from("value")
      },
      {
        key: k2,
        value: Buffer.from("value")
      },
    ]);
    const result = await db.entries();
    expect(result.length).to.be.equal(2);
  });

});
