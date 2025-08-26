import {execSync} from "node:child_process";
import os from "node:os";
import all from "it-all";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {getEnvLogger} from "@lodestar/logger/env";
import {LevelDbController} from "../../../src/index.js";

describe("LevelDB controller", () => {
  const dbLocation = "./.__testdb";
  let db: LevelDbController;

  beforeEach(async () => {
    db = await LevelDbController.create({name: dbLocation}, {metrics: null, logger: getEnvLogger()});
  });

  afterEach(async () => {
    await db.close();
    await LevelDbController.destroy(dbLocation);
  });

  it("test get not found", async () => {
    const key = Buffer.from("not-existing-key");
    expect(await db.get(key)).toBe(null);
  });

  it("test put/get/delete", async () => {
    const key = Buffer.from("test");
    const value = Buffer.from("some value");
    await db.put(key, value);
    expect(await db.get(key)).toEqual(value);
    await db.delete(key);
    expect(await db.get(key)).toBe(null);
  });

  it("test getMany", async () => {
    const key1 = Buffer.from("test 1");
    const value1 = Buffer.from("some value 1");
    await db.put(key1, value1);

    const key2 = Buffer.from("test 2");
    const value2 = Buffer.from("some value 2");
    await db.put(key2, value2);

    await expect(db.getMany([key1, key2])).resolves.toEqual([value1, value2]);
    await db.delete(key1);
    await expect(db.getMany([key1, key2])).resolves.toEqual([undefined, value2]);
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
    expect(await db.get(k1)).not.toBeNull();
    expect(await db.get(k2)).not.toBeNull();
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
    expect((await db.entries()).length).toBe(2);
    await db.batchDelete([k1, k2]);
    expect((await db.entries()).length).toBe(0);
  });

  it("test batch", async () => {
    const [
      {key: k1, value: v1},
      {key: k2, value: v2},
      {key: k3, value: v3},
      {key: k4, value: v4},
      {key: k5, value: v5},
    ] = Array.from({length: 5}, (_, i) => ({
      key: Buffer.from(`test${i}`),
      value: Buffer.from(`some value ${i}`),
    }));
    await db.put(k1, v1);
    await db.put(k2, v2);
    await db.put(k3, v3);

    expect(await db.entries()).toEqual([
      {key: k1, value: v1},
      {key: k2, value: v2},
      {key: k3, value: v3},
    ]);

    await db.batch([
      {
        type: "del",
        key: k1,
      },
      {
        type: "put",
        key: k4,
        value: v4,
      },
      {
        type: "del",
        key: k3,
      },
      {
        type: "put",
        key: k5,
        value: v5,
      },
    ]);

    expect(await db.entries()).toEqual([
      {key: k2, value: v2},
      {key: k4, value: v4},
      {key: k5, value: v5},
    ]);
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
    expect(result.length).toBe(2);
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
    expect(result.length).toBe(2);
  });

  it("test limit", async () => {
    const indexes = Array.from({length: 10}, (_, i) => i);
    const keys = indexes.map((i) => Buffer.from([i]));
    const values = indexes.map((i) => Buffer.from([i]));
    await db.batchPut(keys.map((key, i) => ({key, value: values[i]})));
    const result = await db.entries({limit: 3});
    expect(result.length).toBe(3);
    const resultStream = db.entriesStream({limit: 3});
    expect((await all(resultStream)).length).toBe(3);
  });

  it("test reverse", async () => {
    const indexes = Array.from({length: 10}, (_, i) => i);
    const keys = indexes.map((i) => Buffer.from([i]));
    const values = indexes.map((i) => Buffer.from([i]));
    await db.batchPut(keys.map((key, i) => ({key, value: values[i]})));

    const result = await db.entries({reverse: true, limit: 1, lt: Buffer.from([9])});
    expect(result.length).toBe(1);
    expect(Uint8Array.from(result[0].key)).toEqual(Uint8Array.from([8]));
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

    expect(sizeAfterCompact).toBeLessThan(sizeBeforeCompact);

    // approximateSize is not exact, just test a number is positive
    const approxSize = await db.approximateSize(minKey, maxKey);
    expect(approxSize).toBeGreaterThan(0);
  });

  function getDuCommand(): string {
    if (os.platform() === "darwin") {
      try {
        const res = execSync("gdu --help", {encoding: "utf8"});
        if (res?.startsWith("Usage: gdu ")) {
          return "gdu";
        }
      } catch (_e) {
        console.error("Cannot find gdu command, falling back to du");
      }
    }
    return "du";
  }

  function getDbSize(): number {
    // 116	./.__testdb
    const res = execSync(`${getDuCommand()} -bs ${dbLocation}`, {encoding: "utf8"});
    const match = res.match(/^(\d+)/);
    if (!match) throw Error(`Unknown du response \n${res}`);
    return parseInt(match[1]);
  }
});
