import {spawnSync} from "node:child_process";
import {expect, it} from "vitest";
import {LevelDb} from "../src/leveldb.js";
import {withPath} from "./utils/leveldb.js";

const moduleUrl = new URL("../src/leveldb.js", import.meta.url).href;

function runChild(source: string, path: string, args: string[] = []): void {
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", "--input-type=module", "-e", source, moduleUrl, path, ...args],
    {encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15000}
  );
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
}

it("preserves engine diagnostics and stable codes independently across concurrent opens", async () => {
  await withPath(async (path) => {
    const paths = [`${path}-first`, `${path}-second`];
    await Promise.all(
      paths.map(async (missing) => {
        await expect(LevelDb.open(missing, {createIfMissing: false})).rejects.toMatchObject({
          code: "InvalidArgument",
          message: expect.stringContaining(missing),
        });
      })
    );
    const db = await LevelDb.open(path);
    try {
      await expect(LevelDb.open(path)).rejects.toMatchObject({
        code: "IOError",
        message: expect.stringContaining(path),
      });
      await expect(LevelDb.destroy(path)).rejects.toMatchObject({
        code: "IOError",
        message: expect.stringContaining(path),
      });
    } finally {
      await db.close();
    }
  });
});

it("cleans up failed opens and can immediately retry after the lock owner closes", async () => {
  await withPath(async (path) => {
    const owner = await LevelDb.open(path);
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(LevelDb.open(path)).rejects.toMatchObject({code: "IOError"});
      }
      await owner.put(Uint8Array.of(1), Uint8Array.of(2), {sync: true});
    } finally {
      await owner.close();
    }
    await expect(LevelDb.open(path, {errorIfExists: true})).rejects.toMatchObject({code: "InvalidArgument"});
    const retry = await LevelDb.open(path, {createIfMissing: false});
    try {
      expect(await retry.get(Uint8Array.of(1))).toEqual(Uint8Array.of(2));
    } finally {
      await retry.close();
    }
  });
});

it("rejects invalid options and paths without leaving the target database locked", async () => {
  await withPath(async (path) => {
    await expect(LevelDb.open(path, {maxPendingOperations: 0})).rejects.toThrow("InvalidLimit");
    await expect(LevelDb.open(path, {maxPendingOperations: 65537})).rejects.toThrow("InvalidLimit");
    await expect(LevelDb.open(path, {maxPendingBytes: 0})).rejects.toThrow("InvalidLimit");
    await expect(LevelDb.open(path, {maxPendingBytes: 16 * 1024 * 1024 * 1024 + 1})).rejects.toThrow("InvalidLimit");
    await expect(LevelDb.open(path, {maxOpenFiles: 73})).rejects.toThrow("InvalidOptions");
    await expect(LevelDb.open(path, {writeBufferBytes: 1})).rejects.toThrow("InvalidOptions");
    await expect(LevelDb.open("")).rejects.toThrow("InvalidPath");
    await expect(LevelDb.open(`${path}\0suffix`)).rejects.toThrow("InvalidPath");
    const db = await LevelDb.open(path);
    await db.close();
  });
});

const workerSource = `
const {parentPort, workerData} = require("node:worker_threads");
(async () => {
  const {LevelDb} = await import(workerData.moduleUrl);
  const db = await LevelDb.open(workerData.path);
  await db.batch([
    {type: "put", key: Uint8Array.of(1), value: Uint8Array.of(2)},
    {type: "put", key: Uint8Array.of(3), value: Uint8Array.of(4)},
  ], {sync: true});
  const iterator = db.iterator();
  await iterator.next();
  const pending = [];
  for (let index = 0; index < 16; index++) {
    pending.push(db.put(Uint8Array.of(100 + index), new Uint8Array(1024 * 1024)));
    pending.push(db.getMany([Uint8Array.of(1), Uint8Array.of(3)]));
  }
  Promise.all(pending).catch((error) => { throw error; });
  parentPort.postMessage("queued");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
})().catch((error) => {
  parentPort.postMessage({error: String(error)});
  process.exitCode = 1;
});
`;

it("terminates a worker with concurrent reads, pending writes and a live snapshot, then reuses its database lock", async () => {
  await withPath(async (path) => {
    runChild(
      `
import assert from "node:assert/strict";
import {once} from "node:events";
import {Worker} from "node:worker_threads";
const [moduleUrl, path, source] = process.argv.slice(1);
const {LevelDb} = await import(moduleUrl);
for (let attempt = 0; attempt < 3; attempt++) {
const worker = new Worker(source, {eval: true, execArgv: [], workerData: {moduleUrl, path}});
try {
  const [message] = await once(worker, "message", {signal: AbortSignal.timeout(10000)});
  assert.equal(message, "queued");
  await worker.terminate();
  const reopened = await LevelDb.open(path, {createIfMissing: false});
  try {
    assert.deepEqual(await reopened.get(Uint8Array.of(1)), Uint8Array.of(2));
    await reopened.put(Uint8Array.of(9), Uint8Array.of(10), {sync: true});
  } finally {
    await reopened.close();
  }
} finally {
  await worker.terminate();
}
}
`,
      path,
      [workerSource]
    );
  });
}, 20000);

it("collects an abandoned database during pending work and releases its lock after accepted writes settle", async () => {
  await withPath(async (path) => {
    runChild(
      `
import assert from "node:assert/strict";
import {setTimeout as delay} from "node:timers/promises";
const [moduleUrl, path] = process.argv.slice(1);
const {LevelDb} = await import(moduleUrl);
assert.equal(typeof global.gc, "function");
let database = await LevelDb.open(path);
const weak = new WeakRef(database);
const pending = [];
for (let index = 0; index < 16; index++) {
  pending.push(database.put(Uint8Array.of(index), new Uint8Array(1024 * 1024).fill(index)));
}
database = undefined;
global.gc();
await Promise.all(pending);
let collected = false;
for (let attempt = 0; attempt < 200; attempt++) {
  await delay(10);
  global.gc();
  if (weak.deref() === undefined) {
    collected = true;
    break;
  }
}
assert.equal(collected, true, "Abandoned wrapper was retained after work settled");
let reopened;
for (let attempt = 0; attempt < 200; attempt++) {
  global.gc();
  try {
    reopened = await LevelDb.open(path, {createIfMissing: false});
    break;
  } catch (error) {
    assert.equal(error.code, "IOError");
    await delay(10);
  }
}
assert.ok(reopened, "Collected database did not release its lock");
try {
  const values = await reopened.getMany([Uint8Array.of(0), Uint8Array.of(15)]);
  assert.equal(values[0].length, 1024 * 1024);
  assert.equal(values[0][0], 0);
  assert.equal(values[1].length, 1024 * 1024);
  assert.equal(values[1][1024 * 1024 - 1], 15);
} finally {
  await reopened.close();
}
`,
      path
    );
  });
}, 20000);

it("rejects a page publication failure and still settles queued writes and close", async () => {
  await withPath(async (path) => {
    runChild(
      `
import assert from "node:assert/strict";
const [moduleUrl, path] = process.argv.slice(1);
const {LevelDb} = await import(moduleUrl);
const db = await LevelDb.open(path);
try {
  await db.batch([
    {type: "put", key: Uint8Array.of(1), value: Uint8Array.of(1)},
    {type: "put", key: Uint8Array.of(2), value: Uint8Array.of(2)},
  ]);
  const cursor = db.iterator();
  const injected = new Error("InjectedPublicationFailure");
  Object.defineProperty(Object.prototype, "entries", {
    configurable: true,
    set() {
      delete Object.prototype.entries;
      throw injected;
    },
  });
  const failing = assert.rejects(cursor.next(), (error) => error === injected);
  await Promise.resolve();
  const queued = db.put(Uint8Array.of(3), Uint8Array.of(3));
  await Promise.all([failing, queued]);
  assert.deepEqual(await db.get(Uint8Array.of(3)), Uint8Array.of(3));
  await cursor.close();
} finally {
  delete Object.prototype.entries;
  await db.close();
}
const reopened = await LevelDb.open(path);
await reopened.close();
`,
      path
    );
  });
}, 20000);
