import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {createReadStream} from "node:fs";
import {copyFile, mkdir, mkdtemp, opendir, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {performance} from "node:perf_hooks";
import {parseArgs} from "node:util";
import {LevelDb, type LevelDbOptions} from "../src/leveldb.js";

const MIB = 1024 * 1024;
const {values} = parseArgs({
  options: {
    "archive-mib": {default: "32", type: "string"},
    "cache-mib": {default: "8", type: "string"},
    "offline-sample": {type: "string"},
    "open-files": {default: "1000", type: "string"},
    rounds: {default: "32", type: "string"},
    "start-hex": {default: "", type: "string"},
    "work-dir": {default: tmpdir(), type: "string"},
    "write-buffer-mib": {default: "4", type: "string"},
  },
});

function integer(value: string, minimum: number, maximum: number): number {
  const number = Number(value);
  assert(Number.isSafeInteger(number) && number >= minimum && number <= maximum, `Invalid integer: ${value}`);
  return number;
}

const rounds = integer(values.rounds, 8, 1024);
const archiveBytes = integer(values["archive-mib"], 1, 512) * MIB;
assert((Math.ceil(rounds / 8) + 1) * archiveBytes <= 8 * 1024 * MIB, "Archive writes exceed the 8 GiB workload limit");
const options: LevelDbOptions = {
  cacheBytes: integer(values["cache-mib"], 1, 256) * MIB,
  maxOpenFiles: integer(values["open-files"], 74, 4096),
  writeBufferBytes: integer(values["write-buffer-mib"], 1, 64) * MIB,
};
assert(/^(?:[0-9a-f]{2}){0,4096}$/i.test(values["start-hex"]), "start-hex must encode at most 4096 bytes");
const start = Buffer.from(values["start-hex"], "hex");
const archiveKey = Buffer.from("\xfflodestar-z-benchmark:archive", "latin1");
const blockKey = Buffer.from("\xfflodestar-z-benchmark:block", "latin1");
const missingKey = Buffer.from("\xfflodestar-z-benchmark:missing", "latin1");

function payload(length: number): Buffer {
  const bytes = Buffer.allocUnsafe(length);
  let state = 0x12345678;
  for (let offset = 0; offset < bytes.length; offset++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[offset] = state;
  }
  return bytes;
}

async function copySnapshot(source: string, target: string): Promise<void> {
  await mkdir(target);
  let bytes = 0;
  let files = 0;
  const directory = await opendir(source);
  for await (const entry of directory) {
    assert(++files <= 100_000 && entry.isFile(), "Expected a flat offline LevelDB snapshot");
    const from = join(source, entry.name);
    bytes += (await stat(from)).size;
    assert(bytes <= 8 * 1024 * MIB, "Offline sample exceeds the benchmark's 8 GiB copy limit");
    await copyFile(from, join(target, entry.name));
  }
}

async function seed(path: string): Promise<void> {
  const db = await LevelDb.open(path, options);
  try {
    const value = payload(64 * 1024);
    await db.batch(
      Array.from({length: 256}, (_, index) => {
        const key = Buffer.alloc(4);
        key.writeUInt32BE(index);
        return {key, type: "put" as const, value};
      })
    );
    await db.compactRange(Buffer.alloc(0), Buffer.from([255]));
  } finally {
    await db.close();
  }
}

type Samples = Record<string, number[]>;

async function timed<T>(samples: Samples, name: string, operation: () => Promise<T>): Promise<T> {
  const before = performance.now();
  const pending = operation();
  samples[`${name}_submit`] ??= [];
  samples[`${name}_submit`].push(performance.now() - before);
  const result = await pending;
  samples[name] ??= [];
  samples[name].push(performance.now() - before);
  return result;
}

function distribution(samples: number[]) {
  samples.sort((a, b) => a - b);
  const percentile = (fraction: number) =>
    samples[Math.min(samples.length - 1, Math.ceil(samples.length * fraction) - 1)];
  return {
    count: samples.length,
    max: samples.at(-1),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
  };
}

async function measure(path: string, archiveWrites: boolean, archive: Buffer) {
  const db = await LevelDb.open(path, {...options, createIfMissing: false});
  try {
    const keys: Uint8Array[] = [];
    for await (const key of db.keys({gte: start, limit: 128})) keys.push(key);
    assert(keys.length > 0, "No keys at or after start-hex");
    for (const key of [archiveKey, blockKey, missingKey]) assert.equal(await db.get(key), null);
    await db.put(archiveKey, archive);

    const samples: Samples = {};
    const before = await db.getProperty("leveldb.stats");
    const cursor = db.iterator({fillCache: false, gte: keys[0], lte: keys.at(-1)});
    let pointBytes = 0;
    let rangeBytes = 0;
    const block = payload(128 * 1024);
    try {
      await timed(samples, "range_open", () => cursor.next());
      for (let round = 0; round < rounds; round++) {
        const key = keys[(round * 73) % keys.length];
        cursor.seek(key);
        const operations: Promise<unknown>[] = [];
        if (archiveWrites && round % 8 === 0) {
          operations.push(timed(samples, "archive_write", () => db.put(archiveKey, archive)));
        }
        operations.push(
          timed(samples, "point_hit", () => db.get(key)).then((value) => {
            assert(value !== null);
            pointBytes += value.byteLength;
          }),
          timed(samples, "point_miss", () => db.get(missingKey)).then((value) => assert.equal(value, null)),
          timed(samples, "range_page", () => cursor.nextv(8)).then((entries) => {
            assert(entries.length > 0);
            for (const entry of entries) rangeBytes += entry.key.byteLength + entry.value.byteLength;
          }),
          timed(samples, "block_write", () => db.put(blockKey, block))
        );
        if (round % 8 === 4) {
          operations.push(
            timed(samples, "archive_read", () => db.get(archiveKey, {fillCache: false})).then((value) => {
              assert.equal(value?.byteLength, archive.byteLength);
            })
          );
        }
        const results = await Promise.allSettled(operations);
        for (const result of results) if (result.status === "rejected") throw result.reason;
      }
    } finally {
      await cursor.close();
    }
    return {
      archiveWrites,
      maxRssKiB: process.resourceUsage().maxRSS,
      memory: process.memoryUsage(),
      milliseconds: Object.fromEntries(Object.entries(samples).map(([name, times]) => [name, distribution(times)])),
      pointBytes,
      rangeBytes,
      sampledKeys: keys.length,
      statsAfter: await db.getProperty("leveldb.stats"),
      statsBefore: before,
    };
  } finally {
    await db.close();
  }
}

const root = await mkdtemp(join(resolve(values["work-dir"]), "lodestar-leveldb-bench-"));
try {
  const source = values["offline-sample"] ? resolve(values["offline-sample"]) : join(root, "seed");
  if (!values["offline-sample"]) await seed(source);
  const addon = resolve(import.meta.dirname, "../zig-out/lib/bindings.node");
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(addon)) hash.update(bytes);
  const archive = payload(archiveBytes);
  const cases = [];
  for (const archiveWrites of [false, true]) {
    const target = join(root, archiveWrites ? "with-archive-writes" : "without-archive-writes");
    await copySnapshot(source, target);
    cases.push(await measure(target, archiveWrites, archive));
    await rm(target, {recursive: true});
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        addonSha256: hash.digest("hex"),
        archiveBytes,
        archivePayload: "deterministic synthetic incompressible bytes; asynchronous writes",
        cases,
        commit: execFileSync("git", ["rev-parse", "HEAD"], {cwd: import.meta.dirname, encoding: "utf8"}).trim(),
        node: process.version,
        options,
        rounds,
        source: values["offline-sample"]
          ? {offlineSample: source, startHex: values["start-hex"]}
          : "synthetic smoke only",
        uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? "default",
      },
      null,
      2
    )}\n`
  );
} finally {
  await rm(root, {force: true, recursive: true});
}
