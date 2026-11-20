// Manual benchmark. Build the builder package, then run with an optional baseline builder/lib directory.
// node --expose-gc packages/builder/test/perf/primaryCommitmentJournal.mjs /path/to/baseline/lib
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath, pathToFileURL} from "node:url";
import {ssz} from "@lodestar/types";

const current = fileURLToPath(new URL("../../lib/", import.meta.url));
const directories = process.argv[2] ? {baseline: path.resolve(process.argv[2]), current} : {current};
const implementations = {};
for (const [name, directory] of Object.entries(directories)) {
  const modules = await Promise.all(
    ["asyncCommitmentJournal", "commitmentJournal", "payloadStore", "bidStore", "bidLedger"].map(
      (module) => import(pathToFileURL(path.join(directory, "services", `${module}.js`)).href)
    )
  );
  implementations[name] = Object.assign({}, ...modules);
}

const identity = {genesisValidatorsRoot: "0x" + "11".repeat(32), pubkey: "benchmark"};
const iterations = 40;
const warmup = 8;
const pairs = 10;
const workloads = [
  {transactions: 10, txBytes: 200, accessListBytes: 5000, blobs: 0},
  {transactions: 200, txBytes: 400, accessListBytes: 100000, blobs: 0},
  {transactions: 200, txBytes: 400, accessListBytes: 100000, blobs: 2},
  {transactions: 200, txBytes: 400, accessListBytes: 100000, blobs: 8},
];
const rows = [];

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    p50: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
    max: sorted.at(-1),
  };
}

for (const workload of workloads) {
  const blobsBundle = {
    blobs: Array.from({length: workload.blobs}, (_, j) => new Uint8Array(131072).fill(j)),
    commitments: Array.from({length: workload.blobs}, (_, j) => new Uint8Array(48).fill(j)),
    proofs: Array.from({length: workload.blobs * 128}, (_, j) => new Uint8Array(48).fill(j)),
  };
  const fixtures = Array.from({length: iterations}, (_, index) => {
    const payload = ssz.gloas.ExecutionPayload.defaultValue();
    payload.slotNumber = 100;
    payload.blockHash = Buffer.alloc(32);
    payload.blockHash.writeUInt32BE(index + 1, 28);
    payload.transactions = Array.from({length: workload.transactions}, (_, j) =>
      new Uint8Array(workload.txBytes).fill(j)
    );
    payload.blockAccessList = new Uint8Array(workload.accessListBytes).fill(1);
    const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
    bid.message.slot = 100;
    bid.message.value = index + 1;
    bid.message.blockHash = payload.blockHash;
    bid.message.blobKzgCommitments = blobsBundle.commitments;
    const stored = {
      slot: 100,
      blockHash: "0x" + Buffer.from(payload.blockHash).toString("hex"),
      parentBlockRoot: bid.message.parentBlockRoot,
      payload: {
        sourceId: "benchmark",
        executionPayload: payload,
        executionPayloadValue: BigInt(index + 1),
        executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
        blobsBundle,
      },
    };
    return {bid, stored};
  });
  let expectedFiles;
  for (let pair = 0; pair < pairs; pair++) {
    const names = Object.keys(implementations);
    if (pair % 2) names.reverse();
    for (const name of names) {
      global.gc?.();
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "builder-primary-benchmark-"));
      const {AsyncCommitmentJournal} = implementations[name];
      const journal = await AsyncCommitmentJournal.start({directory: root, identity});
      let timer;
      try {
        const times = [];
        const timerGaps = [];
        let firstRetention;
        let measuring = false;
        let lastTick = performance.now();
        let started;
        let cpuStart;
        timer = setInterval(() => {
          const now = performance.now();
          if (measuring) timerGaps.push(now - lastTick);
          lastTick = now;
        }, 1);
        for (const [index, {bid, stored}] of fixtures.entries()) {
          if (index === warmup) {
            measuring = true;
            lastTick = performance.now();
            started = lastTick;
            cpuStart = process.cpuUsage();
          }
          const before = performance.now();
          await journal.retain(bid, stored);
          const elapsed = performance.now() - before;
          if (index === 0) firstRetention = elapsed;
          if (measuring) times.push(elapsed);
          assert.ok(journal.getReference(stored), `missing durable reference for revision ${index}`);
        }
        const elapsed = performance.now() - started;
        const cpu = process.cpuUsage(cpuStart);
        measuring = false;
        clearInterval(timer);
        await journal.close();

        const files = Object.fromEntries(
          fs
            .readdirSync(root)
            .sort()
            .map((filename) => [
              filename,
              createHash("sha256")
                .update(fs.readFileSync(path.join(root, filename)))
                .digest("hex"),
            ])
        );
        expectedFiles ??= files;
        assert.deepEqual(files, expectedFiles, `${name}: persisted bytes differ`);

        // Use the old reader too, so a faster writer remains safe to roll back.
        const reader = implementations.baseline ?? implementations.current;
        const recovered = new reader.CommitmentJournal(root, identity);
        const payloads = new reader.PayloadStore();
        const bids = new reader.BidStore();
        assert.equal(recovered.recover(100, payloads, bids, new reader.BidLedger()), iterations);
        for (const {bid, stored} of fixtures) {
          const payload = payloads.get(stored.blockHash)?.payload;
          assert.ok(payload, `missing recovered payload ${stored.blockHash}`);
          assert.ok(bids.has(bid), `missing recovered bid ${stored.blockHash}`);
          assert.ok(ssz.gloas.ExecutionPayload.equals(payload.executionPayload, stored.payload.executionPayload));
          assert.ok(ssz.gloas.BlobsBundle.equals(payload.blobsBundle, stored.payload.blobsBundle));
        }
        rows.push({
          workload,
          pair,
          implementation: name,
          retentionMs: distribution(times),
          timerGapMs: distribution(timerGaps),
          revisionsPerSecond: times.length / (elapsed / 1000),
          cpuMsPerRevision: (cpu.user + cpu.system) / 1000 / times.length,
          firstRetentionMs: firstRetention,
          recovered: iterations,
          identicalFiles: Object.keys(files).length,
          times,
        });
      } finally {
        clearInterval(timer);
        await journal.close();
        fs.rmSync(root, {recursive: true, force: true});
      }
    }
  }
}
let filesystem;
try {
  filesystem = execFileSync("findmnt", ["-n", "-o", "FSTYPE", "--target", os.tmpdir()], {encoding: "utf8"}).trim();
} catch {
  filesystem = "unknown";
}
const summaries = workloads.map((workload) => ({
  workload,
  implementations: Object.fromEntries(
    Object.keys(implementations).map((name) => {
      const samples = rows.filter((row) => row.workload === workload && row.implementation === name);
      return [
        name,
        {
          runMedianMs: distribution(samples.map((row) => row.retentionMs.p50)),
          runP95Ms: distribution(samples.map((row) => row.retentionMs.p95)),
          cpuMsPerRevision: distribution(samples.map((row) => row.cpuMsPerRevision)),
          timerGapP95Ms: distribution(samples.map((row) => row.timerGapMs.p95)),
          firstRetentionMs: distribution(samples.map((row) => row.firstRetentionMs)),
        },
      ];
    })
  ),
}));
console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model,
        availableCpus: os.availableParallelism(),
        filesystem,
      },
      sidecars: "Reused across revisions; initial writes are in firstRetentionMs, excluded from warm samples",
      workloads,
      iterations,
      warmup,
      pairs,
      summaries,
      rows,
    },
    null,
    2
  )
);
