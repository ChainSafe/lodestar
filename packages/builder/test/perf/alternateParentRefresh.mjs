// Manual scheduler/signing/journal benchmark, not a native constructor or EL benchmark.
// pnpm --filter '@lodestar/builder...' build
// node --expose-gc packages/builder/test/perf/alternateParentRefresh.mjs > result.json
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {SecretKey} from "@lodestar/native/blst";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {fromHex, sleep, toRootHex} from "@lodestar/utils";
import {AsyncCommitmentJournal} from "../../lib/services/asyncCommitmentJournal.js";
import {Bidder} from "../../lib/services/bidder.js";
import {BidLedger} from "../../lib/services/bidLedger.js";
import {ProportionalBidPolicy} from "../../lib/services/bidPolicy.js";
import {BidPublisher} from "../../lib/services/bidPublisher.js";
import {BidStore} from "../../lib/services/bidStore.js";
import {BuilderSigner} from "../../lib/services/builderSigner.js";
import {PayloadOrchestrator} from "../../lib/services/payloadOrchestrator.js";
import {PayloadStore} from "../../lib/services/payloadStore.js";
import {ProposerPreferencesTracker} from "../../lib/services/proposerPreferencesTracker.js";

const slotMs = 12_000;
const primaryDeadlineBps = 9250;
const stageDeadlines = [9850, 10000, 10400, 10800];
const dependentRoot = Buffer.alloc(32, 7);
const key = SecretKey.fromBytes(Buffer.alloc(32, 1));
const config = getConfig(ForkName.gloas);
const feeRecipient = Buffer.alloc(20, 9);
const transactions = Array.from({length: 150}, (_, i) => new Uint8Array(400).fill(i));
const accessList = new Uint8Array(50_000).fill(1);
const options = {
  shareBps: 10_000,
  fixedCostGwei: 0,
  minValueGwei: 0,
  deadlineBps: primaryDeadlineBps,
  minOperatingBalanceGwei: 1_100_000_000,
  alternateBranches: true,
  alternateBuildDurationMs: 500,
  updateIntervalMs: 100,
};

function distribution(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: sorted[Math.floor(sorted.length / 2)] ?? null,
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)] ?? null,
    max: sorted.at(-1) ?? null,
  };
}

function attributes(root, hash) {
  const data = ssz.gloas.SSEPayloadAttributes.defaultValue();
  data.proposalSlot = 1;
  data.proposerIndex = 3;
  data.parentBlockRoot = Buffer.alloc(32, root);
  data.parentBlockHash = Buffer.alloc(32, hash);
  data.payloadAttributes.parentBeaconBlockRoot = data.parentBlockRoot;
  data.payloadAttributes.slotNumber = 1;
  data.payloadAttributes.timestamp = 12;
  return {
    version: ForkName.gloas,
    data,
    context: {
      role: "alternate",
      dependentRoot,
      builders: [
        {index: 1, pubkey: key.toPublicKey().toBytes(), version: 0, active: true, availableGwei: 9_000_000_000},
      ],
    },
  };
}

async function run(pair, refreshBeforeSlotMs) {
  global.gc?.();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "builder-refresh-benchmark-"));
  const controller = new AbortController();
  const journals = [];
  const builds = [];
  let tick;
  try {
    for (let i = 0; i <= stageDeadlines.length; i++) {
      journals.push(
        await AsyncCommitmentJournal.start({
          directory: path.join(directory, `identity-${i}`),
          sharedPayloadDirectory: path.join(directory, "payloads"),
          identity: {genesisValidatorsRoot: "0x" + "11".repeat(32), pubkey: `benchmark-${i}`},
        })
      );
    }
    const started = Date.now();
    const elapsed = () => Date.now() - started;
    const clock = {
      getCurrentSlot: () => Math.floor(elapsed() / slotMs),
      msToSlot: (slot) => started + slot * slotMs - Date.now(),
      secFromSlot: (slot) => (elapsed() - slot * slotMs) / 1000,
    };
    const logs = [];
    const errors = [];
    const logger = Object.fromEntries(
      ["error", "warn", "info", "verbose", "debug"].map((level) => [
        level,
        (message, context, error) => {
          if (level === "error") errors.push({message, context, error: String(error)});
          else if (message === "Gossiped execution payload bid" || message === "Alternate parent refresh result")
            logs.push({level, message, elapsedMs: elapsed(), ...context});
        },
      ])
    );
    const published = [];
    const api = {
      validator: {
        getProposerDutiesV2: async () => ({
          meta: () => ({dependentRoot: toRootHex(dependentRoot), executionOptimistic: false}),
          value: () => [{slot: 1, validatorIndex: 3, pubkey: Buffer.alloc(48, 3)}],
        }),
      },
      beacon: {
        publishExecutionPayloadBid: async ({signedExecutionPayloadBid}, {beforeRequest, signal}) => {
          signal.throwIfAborted();
          beforeRequest?.();
          const bid = signedExecutionPayloadBid.message;
          published.push({
            builderIndex: bid.builderIndex,
            elapsedMs: elapsed(),
            valueGwei: bid.value,
            parent: toRootHex(bid.parentBlockHash),
          });
          await sleep(2, signal);
          return {assertOk() {}};
        },
      },
    };
    const sessions = new Map();
    const attempts = [];
    let preparing = 0;
    let releasing = 0;
    let maximumWorkers = 0;
    let nextId = 0;
    const source = {
      id: "benchmark",
      supportsUpdates: true,
      supportsBoundedAlternates: true,
      getResources: () => ({
        capacity: 2,
        preparing,
        releasing,
        active: sessions.size - releasing,
        uncertain: 0,
        alternatesDisabled: false,
      }),
      prepare: async (request, signal) => {
        assert.ok(sessions.size + preparing < 2, "provider exceeded two workers");
        preparing++;
        try {
          await sleep(2, signal);
          const payloadId = String(++nextId);
          sessions.set(payloadId, {request, cache: new Map()});
          maximumWorkers = Math.max(maximumWorkers, sessions.size);
          attempts.push({alternate: request.requireUnleased === true, elapsedMs: elapsed()});
          return {sourceId: "benchmark", fork: ForkName.gloas, payloadId};
        } finally {
          preparing--;
        }
      },
      getPayload: async (handle, signal) => {
        await sleep(5, signal);
        const session = sessions.get(handle.payloadId);
        assert.ok(session, "missing fake provider session");
        const {request, cache} = session;
        const parentHash = fromHex(request.forkchoiceState.headBlockHash);
        const isOldParent = parentHash[0] === 44;
        const count = isOldParent
          ? Math.min(130, 35 + Math.floor(Math.max(0, elapsed() - 4000) / 80))
          : Math.min(150, 45 + Math.floor(Math.max(0, elapsed() - 3500) / 100));
        if (!cache.has(count)) {
          const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
          Object.assign(executionPayload, {
            parentHash,
            blockHash: createHash("sha256").update(parentHash).update(String(count)).digest(),
            slotNumber: 1,
            timestamp: 12,
            prevRandao: request.payloadAttributes.prevRandao,
            feeRecipient,
            gasLimit: 60_000_000,
            gasUsed: count * 100_000,
            transactions: transactions.slice(0, count),
            blockAccessList: accessList,
          });
          cache.set(count, {
            sourceId: "benchmark",
            fork: ForkName.gloas,
            executionPayload,
            executionPayloadValue: BigInt(count) * 1_000_000_000_000_000n,
            executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
            blobsBundle: ssz.fulu.BlobsBundle.defaultValue(),
          });
        }
        return cache.get(count);
      },
      release: async (handle) => {
        releasing++;
        try {
          await sleep(2);
          sessions.delete(handle.payloadId);
        } finally {
          releasing--;
        }
      },
    };
    const payloadStore = new PayloadStore();
    const retentions = [];
    const getBuilderStatus = () => ({status: "active", balance: 10_000_000_000});
    const identities = journals.map((journal, i) => {
      const ledger = new BidLedger();
      const stageKey = SecretKey.fromBytes(Buffer.alloc(32, i + 1));
      const bidPublisher = new BidPublisher({
        api,
        config,
        signer: new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
          secretKey: stageKey,
          publicKey: stageKey.toPublicKey(),
        }),
        ledger,
        builderIndex: i + 1,
        hasPayload: ({blockHash}) => payloadStore.has(blockHash),
        retainCommitment: async (bid) => {
          const stored = payloadStore.get(toRootHex(bid.message.blockHash));
          assert.ok(stored, "missing payload for durable journal");
          const before = performance.now();
          const mode = await journal.retainShared(bid, stored, journals[0].getReference(stored));
          retentions.push({
            builderIndex: i + 1,
            oldParent: bid.message.parentBlockHash[0] === 44,
            elapsedMs: elapsed(),
            durationMs: performance.now() - before,
            mode,
          });
        },
      });
      return {builderIndex: i + 1, ledger, bidStore: new BidStore(), bidPublisher, getBuilderStatus};
    });
    const primary = identities[0];
    const tracker = new ProposerPreferencesTracker();
    const preferences = ssz.gloas.SignedProposerPreferences.defaultValue();
    preferences.message.proposalSlot = 1;
    preferences.message.dependentRoot = dependentRoot;
    preferences.message.targetGasLimit = 60_000_000n;
    tracker.onProposerPreferences(preferences);
    const bidder = new Bidder(
      {
        ...primary,
        gossipStages: identities.slice(1).map((identity, i) => ({...identity, deadlineBps: stageDeadlines[i]})),
        config,
        logger,
        clock,
        api,
        orchestrator: new PayloadOrchestrator(source, {getPayloadTimeout: 1000}, controller.signal),
        payloadStore,
        policy: new ProportionalBidPolicy(options),
        proposerPreferencesTracker: tracker,
        builderPubkey: key.toPublicKey().toBytes(),
        canRetainAlternate: () => journals[0].canRetainAlternate(),
        executionFeeRecipient: feeRecipient,
        metrics: null,
        signal: controller.signal,
      },
      {...options, alternateRefreshBeforeSlotMs: refreshBeforeSlotMs}
    );
    const timerGaps = [];
    let lastTick = performance.now();
    tick = setInterval(() => {
      const now = performance.now();
      timerGaps.push(now - lastTick);
      lastTick = now;
    }, 1);
    const cpuStart = process.cpuUsage();
    const at = async (time) => sleep(Math.max(0, time - elapsed()));
    const old = attributes(33, 44);
    const start = (event) => builds.push(bidder.onPayloadAttributes({version: event.version, data: event.data}));
    await at(2000);
    start(old);
    await at(3045);
    start(attributes(4, 5));
    await at(3397);
    start(attributes(4, 6));
    await at(3500);
    bidder.onAlternatePayloadAttributes(old);
    await at(13_250);
    controller.abort();
    await Promise.all(builds);
    clearInterval(tick);
    const cpu = process.cpuUsage(cpuStart);
    const offer = primary.bidStore.get(1, toRootHex(old.data.parentBlockHash), toRootHex(old.data.parentBlockRoot));
    assert.ok(offer, "missing old-parent offer");
    if (refreshBeforeSlotMs) {
      assert.ok(offer.message.value >= 129_000_000 && offer.message.value <= 130_000_000);
    } else {
      assert.equal(offer.message.value, 35_000_000);
    }
    assert.equal(published.length, 4, "primary and stages clearing the existing 3% gossip floor must publish");
    assert.deepEqual(
      published.map((bid) => bid.builderIndex),
      [1, 2, 4, 5]
    );
    assert.ok(
      published.every((bid) => bid.parent === toRootHex(Buffer.alloc(32, 6))),
      "unexpected alternate gossip"
    );
    assert.equal(attempts.filter((attempt) => attempt.alternate).length, refreshBeforeSlotMs ? 1 : 0);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(sessions.size, 0, "all workers must be released");
    return {
      pair,
      refreshBeforeSlotMs,
      oldParentOfferGwei: offer.message.value,
      primaryRevisions: primary.ledger
        .getBidsForSlot(1)
        .filter((bid) => bid.parentBlockHash === toRootHex(Buffer.alloc(32, 6))).length,
      primaryFinalValueGwei: primary.bidStore.get(1, toRootHex(Buffer.alloc(32, 6)), toRootHex(Buffer.alloc(32, 4)))
        ?.message.value,
      maximumWorkers,
      sourceAttempts: attempts,
      published,
      gossipTiming: logs.filter((log) => log.message === "Gossiped execution payload bid"),
      refreshResult: logs.filter((log) => log.message === "Alternate parent refresh result"),
      retentionMs: distribution(retentions.map((row) => row.durationMs)),
      alternateRetentionMs: distribution(
        retentions.filter((row) => row.oldParent && row.elapsedMs > 11_000).map((row) => row.durationMs)
      ),
      stageRetentionMs: distribution(retentions.filter((row) => row.builderIndex > 1).map((row) => row.durationMs)),
      retentions,
      timerGapMs: distribution(timerGaps),
      cpuMs: (cpu.user + cpu.system) / 1000,
      retainedBytes: payloadStore.bytes,
      retainedPayloads: payloadStore.size,
    };
  } finally {
    controller.abort();
    clearInterval(tick);
    await Promise.allSettled(builds);
    await Promise.all(journals.map((journal) => journal.close()));
    fs.rmSync(directory, {recursive: true, force: true});
  }
}

const rows = [];
for (let pair = 0; pair < 2; pair++) {
  for (const lead of pair % 2 ? [800, 0] : [0, 800]) rows.push(await run(pair, lead));
}
let filesystem;
try {
  filesystem = execFileSync("findmnt", ["-n", "-o", "FSTYPE", "--target", os.tmpdir()], {encoding: "utf8"}).trim();
} catch {
  filesystem = "unknown";
}
console.log(
  JSON.stringify(
    {
      environment: {
        node: process.version,
        cpu: os.cpus()[0]?.model,
        availableCpus: os.availableParallelism(),
        filesystem,
      },
      scope:
        "Same deterministic arrivals with real wall-clock scheduler, signing, payload retention and worker-backed filesystem journals. Fake two-worker provider delays prepare/retrieve/release by 2/5/2 ms. No native execution, proof loading, network gossip, or real fees; this cannot prove native throughput or live win-rate improvement.",
      workload: {
        slotMs,
        primaryDeadlineBps,
        stageDeadlines,
        txBytes: 400,
        accessListBytes: 50_000,
        oldParentTransactions: {off: 35, onMin: 129, onMax: 130},
        txValueGwei: 1_000_000,
        pairs: 2,
      },
      rows,
    },
    null,
    2
  )
);
