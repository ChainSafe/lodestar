// Run from the repository root: node --import tsx bindings/perf/depositCacheStress.ts
// Mirrors https://gist.github.com/nflaig/dad413fbcca4e1772a708d3efe433c48.
import assert from "node:assert/strict";
import {performance} from "node:perf_hooks";
import type {electra} from "@lodestar/types";
import {init, scrapeMetrics} from "../src/metrics.js";
import {createNative, signedDeposit} from "../test/depositCacheFixture.js";

const builder = signedDeposit(91);
const validator = signedDeposit(91, 1);
const deposits: electra.PendingDeposit[] = [];
for (let i = 0; i < 4000; i++) {
  deposits.push({...validator, amount: validator.amount + i + 1});
  if (i % 3 === 0 && i / 3 < 1300) deposits.push({...builder, amount: builder.amount + i + 1});
}
deposits.push(builder, signedDeposit(92));
for (let i = 0; i < 51; i++) deposits.push({...validator, amount: validator.amount + i + 1});
for (let i = 0; i < 10000; i++) deposits.push(signedDeposit(i + 1000));
const highIndex = signedDeposit(93);
deposits.push(highIndex);
for (let i = 0; i < 900; i++) deposits.push({...highIndex, amount: highIndex.amount + i + 1});
for (const lastByte of [0, 1, 4]) {
  for (const firstByte of [0x80, 0xc0]) {
    const pubkey = new Uint8Array(48);
    pubkey[0] = firstByte;
    pubkey[47] = lastByte;
    for (let i = 0; i < 4; i++) deposits.push({...builder, amount: builder.amount + i, pubkey});
  }
}
deposits.push(signedDeposit(94, 1), signedDeposit(94));
init();
const {state} = createNative(deposits);
const {state: coldSource} = createNative(deposits);
const before = state.hashTreeRoot();
const warmupStart = performance.now();
const calls = [];
let lastCached = -1;
for (let tick = 0; tick < 62; tick++) {
  const started = performance.now();
  const result = state.preVerifyBuilderDepositsPreGloas(10000, 1200);
  calls.push({durationMs: performance.now() - started, ...result});
  if (result.totalCachedDeposits === lastCached) break;
  lastCached = result.totalCachedDeposits;
}
const warmupMs = performance.now() - warmupStart;
assert.deepEqual(state.hashTreeRoot(), before);
const coldStart = performance.now();
const cold = coldSource.processSlots(coldSource.slot + 1, {dontTransferCache: true});
const coldMs = performance.now() - coldStart;
const coldMetrics = scrapeMetrics();
const warmStart = performance.now();
const warm = state.processSlots(state.slot + 1, {dontTransferCache: true});
const warmMs = performance.now() - warmStart;
const warmMetrics = scrapeMetrics();
assert.deepEqual(warm.hashTreeRoot(), cold.hashTreeRoot(), "cold/warm Gloas state roots");
assert.equal(warm.getBuildersLength(), 10003);
assert.equal(warm.getBuilder(0).balance, builder.amount + 51 * validator.amount + (51 * 52) / 2);
assert.equal(warm.getBuilder(10002).balance, 901 * highIndex.amount + (900 * 901) / 2);
assert.equal(warm.pendingDepositsCount, 4002);
assert(warmMetrics.includes('stfn_gloas_onboard_builders_signature_checks{source="verified"} 0\n'));
process.stdout.write(
  `${JSON.stringify(
    {
      calls,
      coldChecks: coldMetrics
        .split("\n")
        .filter((line) => line.includes("stfn_gloas_onboard_builders_signature_checks{")),
      coldMs,
      deposits: deposits.length,
      rssBytes: process.memoryUsage().rss,
      warmChecks: warmMetrics
        .split("\n")
        .filter((line) => line.includes("stfn_gloas_onboard_builders_signature_checks{")),
      warmMs,
      warmupMs,
    },
    null,
    2
  )}\n`
);
warm.release();
cold.release();
coldSource.release();
state.release();
