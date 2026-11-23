import {spawnSync} from "node:child_process";
import {symlink} from "node:fs/promises";
import {expect, it} from "vitest";
import {LevelDb} from "../src/leveldb.js";
import {bytes, withPath} from "./utils/leveldb.js";

const moduleUrl = new URL("../src/leveldb.js", import.meta.url).href;

it("validates engine option ranges even when joining an existing database", async () => {
  await withPath(async (path) => {
    const first = await LevelDb.open(path, {multithreading: true});
    try {
      for (const options of [{maxOpenFiles: 73}, {writeBufferBytes: 65535}]) {
        await expect(LevelDb.open(path, {...options, multithreading: true})).rejects.toMatchObject({
          code: "InvalidOptions",
        });
      }
      const second = await LevelDb.open(path, {
        maxOpenFiles: 74,
        multithreading: true,
        writeBufferBytes: 65536,
      });
      await second.close();
    } finally {
      await first.close();
    }
  });
});

function runChild(source: string, path: string): void {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, moduleUrl, path, workerSource], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: 20000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.signal, result.stderr).toBeNull();
  expect(result.status, result.stderr).toBe(0);
}

it("shares the first engine's options while keeping admission and snapshots local to each handle", async () => {
  await withPath(async (path) => {
    const first = await LevelDb.open(path, {maxPendingOperations: 1, multithreading: true});
    const second = await LevelDb.open(path, {errorIfExists: true, maxPendingOperations: 4, multithreading: true});
    try {
      await first.batch([
        {key: bytes(1), type: "put", value: bytes(10)},
        {key: bytes(2), type: "put", value: bytes(20)},
      ]);
      expect(await second.get(bytes(1))).toEqual(bytes(10));
      const iterator = second.iterator();
      try {
        expect((await iterator.next()).value).toEqual({key: bytes(1), value: bytes(10)});
        await first.put(bytes(2), bytes(21));
        expect((await iterator.next()).value).toEqual({key: bytes(2), value: bytes(20)});
      } finally {
        await iterator.close();
      }
      const accepted = first.put(bytes(3), bytes(30));
      const rejected = first.put(bytes(4), bytes(40));
      const independent = second.put(bytes(5), bytes(50));
      await expect(rejected).rejects.toThrow("PendingOperationsExceeded");
      await Promise.all([accepted, independent]);
      await first.close();
      await second.put(bytes(6), bytes(60));
      expect(await second.get(bytes(6))).toEqual(bytes(60));
      await expect(LevelDb.destroy(path)).rejects.toMatchObject({code: "IOError"});
    } finally {
      await Promise.all([first.close(), second?.close()]);
    }
    const exclusive = await LevelDb.open(path);
    await exclusive.close();
    await LevelDb.destroy(path);
  });
});

it("requires opt-in on every handle and resolves directory aliases before sharing or destroying", async () => {
  await withPath(async (path) => {
    await expect(LevelDb.open(path, {multithreading: 1 as unknown as boolean})).rejects.toThrow("InvalidOptions");
    const exclusive = await LevelDb.open(path);
    const alias = `${path}-alias`;
    try {
      await symlink(path, alias, "dir");
      await expect(LevelDb.open(alias, {multithreading: true})).rejects.toMatchObject({code: "IOError"});
      await expect(LevelDb.open(alias)).rejects.toMatchObject({code: "IOError"});
      await expect(LevelDb.destroy(alias)).rejects.toMatchObject({code: "IOError"});
    } finally {
      await exclusive.close();
    }
    const shared = await LevelDb.open(path, {multithreading: true});
    try {
      await expect(LevelDb.open(alias)).rejects.toMatchObject({code: "IOError"});
      const other = await LevelDb.open(alias, {multithreading: true});
      try {
        await shared.put(bytes(1), bytes(2));
        expect(await other.get(bytes(1))).toEqual(bytes(2));
      } finally {
        await other.close();
      }
    } finally {
      await shared.close();
    }
  });
});

const workerSource = `
const {parentPort, workerData} = require("node:worker_threads");
(async () => {
  const {LevelDb} = await import(workerData.moduleUrl);
  const db = await LevelDb.open(workerData.path, {multithreading: true});
  let cursor;
  const cursors = [];
  parentPort.on("message", async (command) => {
    try {
      let result;
      if (command.kind === "get") result = Array.from(await db.get(Uint8Array.of(command.key)));
      if (command.kind === "put") await db.put(Uint8Array.of(command.key), Uint8Array.of(command.value));
      if (command.kind === "cursor") {
        cursor = db.iterator();
        await cursor.next();
      }
      if (command.kind === "next") result = (await cursor.next()).value;
      if (command.kind === "cursors") {
        for (let index = 0; index < 32; index++) cursors.push(db.iterator());
        await Promise.all(cursors.map((item) => item.next()));
      }
      if (command.kind === "park") {
        cursor = db.iterator();
        await cursor.next();
        const pending = [];
        for (let index = 0; index < 16; index++) {
          pending.push(db.put(Uint8Array.of(100 + index), new Uint8Array(64 * 1024)));
        }
        Promise.all(pending).catch(() => {});
        parentPort.postMessage({ok: true});
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
        return;
      }
      if (command.kind === "close") await db.close();
      parentPort.postMessage({ok: true, result});
      if (command.kind === "close") parentPort.close();
    } catch (error) {
      parentPort.postMessage({ok: false, error: String(error)});
    }
  });
  parentPort.postMessage({ok: true});
})().catch((error) => {
  parentPort.postMessage({ok: false, error: String(error)});
  parentPort.close();
});
`;

const childPrelude = `
import assert from "node:assert/strict";
import {once} from "node:events";
import {Worker} from "node:worker_threads";
const [moduleUrl, path, workerSource] = process.argv.slice(1);
const {LevelDb} = await import(moduleUrl);
const bytes = (...values) => Uint8Array.from(values);
const workers = [];
const receive = async (worker) => {
  const [message] = await once(worker, "message", {signal: AbortSignal.timeout(5000)});
  assert.equal(message.ok, true, message.error);
  return message.result;
};
const start = async () => {
  const worker = new Worker(workerSource, {eval: true, execArgv: [], workerData: {moduleUrl, path}});
  workers.push(worker);
  await receive(worker);
  return worker;
};
const command = async (worker, message) => {
  const result = receive(worker);
  worker.postMessage(message);
  return result;
};
`;

it("shares concurrent worker opens and keeps the engine and cache alive in either close order", async () => {
  await withPath(async (path) => {
    runChild(
      `${childPrelude}
let db;
try {
  const [first, second] = await Promise.all([start(), start()]);
  db = await LevelDb.open(path, {multithreading: true});
  await db.batch([
    {type: "put", key: bytes(1), value: bytes(10)},
    {type: "put", key: bytes(2), value: bytes(20)},
  ]);
  await db.compactRange(bytes(), bytes(255));
  assert.deepEqual(await command(first, {kind: "get", key: 1}), [10]);
  await command(first, {kind: "cursor"});
  await Promise.all([
    command(second, {kind: "put", key: 2, value: 21}),
    db.put(bytes(3), bytes(30)),
  ]);
  assert.deepEqual(await command(first, {kind: "next"}), {key: bytes(2), value: bytes(20)});
  await command(first, {kind: "close"});
  assert.deepEqual(await db.get(bytes(2)), bytes(21));
  await db.close();
  db = undefined;
  assert.deepEqual(await command(second, {kind: "get", key: 1}), [10]);
  await command(second, {kind: "put", key: 4, value: 40});
  await command(second, {kind: "close"});
  db = await LevelDb.open(path);
  assert.deepEqual(await db.get(bytes(4)), bytes(40));
} finally {
  await Promise.all(workers.map((worker) => worker.terminate()));
  await db?.close();
}
`,
      path
    );
  });
}, 25000);

it("retires a terminated worker's queued work and live cursor without closing another owner", async () => {
  await withPath(async (path) => {
    runChild(
      `${childPrelude}
const db = await LevelDb.open(path, {multithreading: true});
try {
  await db.batch([
    {type: "put", key: bytes(1), value: bytes(10)},
    {type: "put", key: bytes(2), value: bytes(20)},
  ]);
  const worker = await start();
  await command(worker, {kind: "park"});
  await worker.terminate();
  assert.deepEqual(await db.get(bytes(1)), bytes(10));
  await db.put(bytes(3), bytes(30));
  await assert.rejects(LevelDb.destroy(path), {code: "IOError"});
} finally {
  await Promise.all(workers.map((worker) => worker.terminate()));
  await db.close();
}
const reopened = await LevelDb.open(path);
await reopened.close();
`,
      path
    );
  });
}, 25000);

it("retires an unpublished shared cursor without invalidating another environment", async () => {
  await withPath(async (path) => {
    runChild(
      `${childPrelude}
const db = await LevelDb.open(path, {multithreading: true});
try {
  await db.batch([
    {type: "put", key: bytes(1), value: bytes(10)},
    {type: "put", key: bytes(2), value: bytes(20)},
  ]);
  await db.compactRange(bytes(), bytes(255));
  const worker = await start();
  assert.deepEqual(await command(worker, {kind: "get", key: 1}), [10]);
  const cursor = db.iterator();
  const injected = new Error("InjectedPublicationFailure");
  Object.defineProperty(Object.prototype, "entries", {
    configurable: true,
    set() {
      delete Object.prototype.entries;
      throw injected;
    },
  });
  await assert.rejects(cursor.next(), (error) => error === injected);
  await cursor.close();
  await db.close();
  assert.deepEqual(await command(worker, {kind: "get", key: 1}), [10]);
  await command(worker, {kind: "close"});
} finally {
  delete Object.prototype.entries;
  await Promise.all(workers.map((worker) => worker.terminate()));
  await db.close();
}
const reopened = await LevelDb.open(path);
await reopened.close();
`,
      path
    );
  });
}, 25000);

it("reserves shared cursor capacity atomically and recovers it when an environment closes", async () => {
  await withPath(async (path) => {
    runChild(
      `${childPrelude}
const db = await LevelDb.open(path, {multithreading: true});
try {
  await db.batch([
    {type: "put", key: bytes(1), value: bytes(10)},
    {type: "put", key: bytes(2), value: bytes(20)},
  ]);
  const [first, second] = await Promise.all([start(), start()]);
  await Promise.all([
    command(first, {kind: "cursors"}),
    command(second, {kind: "cursors"}),
  ]);
  const refused = db.iterator();
  await assert.rejects(refused.next(), {message: "CursorCapacity"});
  await refused.close();
  await command(first, {kind: "close"});
  const admitted = db.iterator();
  assert.deepEqual((await admitted.next()).value, {key: bytes(1), value: bytes(10)});
  await admitted.close();
  await second.terminate();
} finally {
  await Promise.all(workers.map((worker) => worker.terminate()));
  await db.close();
}
const reopened = await LevelDb.open(path);
await reopened.close();
`,
      path
    );
  });
}, 25000);
