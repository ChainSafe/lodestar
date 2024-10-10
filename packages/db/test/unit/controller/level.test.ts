import {execSync} from "node:child_process";
import os from "node:os";
import {describe, it, expect, beforeAll, afterAll} from "vitest";
import all from "it-all";
import {getEnvLogger} from "@lodestar/logger/env";
import {LevelDbController} from "../../../src/controller/index.js";

describe("LevelDB controller", () => {
  const dbLocation = "./.__testdb";
  let db: LevelDbController;

  beforeAll(async () => {
    db = await LevelDbController.create({name: dbLocation}, {metrics: null, logger: getEnvLogger()});
  });

  afterAll(async () => {
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
        /* eslint-disable no-console */
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
