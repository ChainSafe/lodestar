import {Worker} from "node:worker_threads";
import {performance} from "node:perf_hooks";

import * as blst from "@chainsafe/blst";

const workerSource = `
import {parentPort, workerData} from "node:worker_threads";
import {performance} from "node:perf_hooks";

const bls = await import(workerData.moduleName);
const {PublicKey, Signature, verify, verifyMultipleAggregateSignatures} = bls;
const sets = workerData.sets;
const batchSizes = workerData.batchSizes;
const iterations = workerData.iterations;
const offset = workerData.offset;
const mode = workerData.mode;

let preparedSets = null;
let prepareMs = 0;

if (mode === "verify-only") {
  const t0 = performance.now();
  preparedSets = sets.map((s) => ({
    pk: PublicKey.fromBytes(s.pk),
    sig: Signature.fromBytes(s.sig, true),
    msg: s.msg,
  }));
  prepareMs = performance.now() - t0;
}

function verifyBatchDeserialize(start, size) {
  if (size === 1) {
    const s = sets[start % sets.length];
    const pk = PublicKey.fromBytes(s.pk);
    const sig = Signature.fromBytes(s.sig, true);
    return verify(s.msg, pk, sig);
  }

  const batch = new Array(size);
  for (let i = 0; i < size; i++) {
    const s = sets[(start + i) % sets.length];
    batch[i] = {
      pk: PublicKey.fromBytes(s.pk),
      msg: s.msg,
      sig: Signature.fromBytes(s.sig, true),
    };
  }
  return verifyMultipleAggregateSignatures(batch);
}

function verifyBatchPrepared(start, size) {
  if (size === 1) {
    const s = preparedSets[start % preparedSets.length];
    return verify(s.msg, s.pk, s.sig);
  }

  const batch = new Array(size);
  for (let i = 0; i < size; i++) {
    const s = preparedSets[(start + i) % preparedSets.length];
    batch[i] = {pk: s.pk, msg: s.msg, sig: s.sig};
  }
  return verifyMultipleAggregateSignatures(batch);
}

const verifyBatch = mode === "verify-only" ? verifyBatchPrepared : verifyBatchDeserialize;

let invalid = 0;
let sigSets = 0;
let elapsedMs = 0;

for (let i = 0; i < iterations; i++) {
  const size = batchSizes[(i + offset) % batchSizes.length];
  const start = (offset * 8191 + i * 37) % sets.length;
  const t0 = performance.now();
  if (!verifyBatch(start, size)) invalid++;
  elapsedMs += performance.now() - t0;
  sigSets += size;
}

parentPort.postMessage({elapsedMs, sigSets, invalid, prepareMs});
`;

const datasetSize = Number(process.env.BLS_BENCH_DATASET ?? 2048);
const iterationsPerWorker = Number(process.env.BLS_BENCH_ITERS ?? 800);
const workerCounts = (process.env.BLS_BENCH_WORKERS ?? "1,2,4,8,11")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const batchSizes = (process.env.BLS_BENCH_BATCHES ?? "1,2,4,8,16,24,32")
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isInteger(n) && n > 0);
const modes = (process.env.BLS_BENCH_MODES ?? "deserialize+verify,verify-only")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const moduleNames = (process.env.BLS_BENCH_MODULES ?? "@chainsafe/blst,@chainsafe/lodestar-z/blst")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function makeSet(i) {
  const ikm = Buffer.alloc(32);
  ikm.writeUInt32LE(i + 1, 0);
  ikm.fill((i * 31) & 0xff, 4);

  const msg = Buffer.alloc(32);
  msg.writeUInt32LE(i + 1, 0);
  msg.fill((i * 17) & 0xff, 4);

  const sk = blst.SecretKey.fromKeygen(ikm);
  const pk = sk.toPublicKey();
  const sig = sk.sign(msg);
  return {pk: pk.toBytes(), sig: sig.toBytes(), msg};
}

async function runCase(moduleName, mode, workers) {
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({length: workers}, (_, i) => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(workerSource, {
          eval: true,
          type: "module",
          workerData: {
            moduleName,
            mode,
            sets,
            batchSizes,
            iterations: iterationsPerWorker,
            offset: i,
          },
        });
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
          if (code !== 0) reject(new Error(`worker exited with code ${code}`));
        });
      });
    })
  );

  const wallMs = performance.now() - t0;
  const elapsedMs = results.reduce((sum, r) => sum + r.elapsedMs, 0);
  const sigSets = results.reduce((sum, r) => sum + r.sigSets, 0);
  const invalid = results.reduce((sum, r) => sum + r.invalid, 0);
  const prepareMs = results.reduce((sum, r) => sum + r.prepareMs, 0);

  return {
    moduleName,
    mode,
    workers,
    sigSets,
    invalid,
    wallMs,
    workerMs: elapsedMs,
    prepareMs,
    sigSetsPerSecWall: (sigSets / wallMs) * 1000,
    avgWorkerMsPerSet: elapsedMs / sigSets,
    avgPrepareMsPerSet: prepareMs / (datasetSize * workers),
  };
}

function printResult(r) {
  console.log(
    [
      r.moduleName.padEnd(28),
      r.mode.padEnd(18),
      `workers=${String(r.workers).padStart(2)}`,
      `sets=${String(r.sigSets).padStart(7)}`,
      `invalid=${r.invalid}`,
      `wall=${r.wallMs.toFixed(1)}ms`,
      `sets/s=${r.sigSetsPerSecWall.toFixed(0)}`,
      `worker_ms/set=${r.avgWorkerMsPerSet.toFixed(4)}`,
      `prep_ms/set=${r.avgPrepareMsPerSet.toFixed(4)}`,
    ].join("  ")
  );
}

console.log(
  JSON.stringify({
    datasetSize,
    iterationsPerWorker,
    workerCounts,
    batchSizes,
    modes,
    moduleNames,
    node: process.version,
    arch: `${process.platform}/${process.arch}`,
  })
);

console.log("generating dataset...");
const sets = Array.from({length: datasetSize}, (_, i) => makeSet(i));
console.log("module                         mode                workers  sets     invalid  wall       sets/s  worker_ms/set  prep_ms/set");

for (const workers of workerCounts) {
  for (const mode of modes) {
    for (const moduleName of moduleNames) {
      printResult(await runCase(moduleName, mode, workers));
    }
  }
}
