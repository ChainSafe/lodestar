// Isolated real journal worker benchmark. Only deterministic synthetic payloads/signing keys.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {MessageChannel, Worker} from "node:worker_threads";
const root = path.resolve(process.argv[2]);
const scratch = path.resolve(process.argv[3]);
const variant = process.argv[4];
assert(["baseline", "batched"].includes(variant));
const imp = (p) => import(root + "/" + p);
const {SecretKey} = await imp("packages/builder/node_modules/@lodestar/native/bindings/src/blst.js");
const {createBeaconConfig} = await imp("packages/config/lib/index.js");
const {getConfig} = await imp("packages/config/lib/testUtils/index.js");
const {ForkName} = await imp("packages/params/lib/index.js");
const {ssz} = await imp("packages/types/lib/index.js");
const {AsyncCommitmentJournal} = await imp("packages/builder/lib/services/asyncCommitmentJournal.js");
const {CommitmentJournal} = await imp("packages/builder/lib/services/commitmentJournal.js");
const {BuilderSigner} = await imp("packages/builder/lib/services/builderSigner.js");
const {BidPublisher} = await imp("packages/builder/lib/services/bidPublisher.js");
const {BidLedger} = await imp("packages/builder/lib/services/bidLedger.js");
const {PayloadStore} = await imp("packages/builder/lib/services/payloadStore.js");
const {BidStore} = await imp("packages/builder/lib/services/bidStore.js");
const {createExecutionPayloadBid} = await imp("packages/builder/lib/services/executionPayloadBid.js");
const config = getConfig(ForkName.gloas),
  key = SecretKey.fromBytes(Buffer.alloc(32, 2));
const signer = new BuilderSigner(createBeaconConfig(config, Buffer.alloc(32)), {
  secretKey: key,
  publicKey: key.toPublicKey(),
});
const identity = {genesisValidatorsRoot: `0x${"00".repeat(32)}`, pubkey: signer.getPubkeyHex()};
const cpuStats = () =>
  Object.fromEntries(
    fs
      .readFileSync("/sys/fs/cgroup/cpu.stat", "utf8")
      .trim()
      .split("\n")
      .map((line) => {
        const [key, value] = line.split(" ");
        return [key, Number(value)];
      })
  );
const initialCpu = cpuStats();
const directory = path.join(scratch, "journal");
assert(!fs.existsSync(directory));
fs.mkdirSync(directory);
const primary = await AsyncCommitmentJournal.start({directory: path.join(directory, "primary"), identity});
const channel = new MessageChannel();
const profiles = [];
channel.port1.on("message", (row) => profiles.push(row));
const worker = new Worker(path.join(root, "packages/builder/lib/services/commitmentJournalWorker.js"), {
  workerData: {
    directory: path.join(directory, "stage"),
    identity,
    sharedPayloadDirectory: path.join(directory, "primary"),
    profilePort: channel.port2,
  },
  transferList: [channel.port2],
  execArgv: ["--import", new URL("./profile-preload.mjs", import.meta.url).href],
});
const stage = new AsyncCommitmentJournal(worker);
await stage.ready.promise;
const payloads = new PayloadStore(),
  ledger = new BidLedger(),
  rows = [];
let signMs = 0,
  retentionMs = 0;
const stamp = () => performance.timeOrigin + performance.now();
let startRetainAt, endRetainAt;
const publisher = new BidPublisher({
  config,
  builderIndex: 2,
  api: {beacon: {publishExecutionPayloadBid: async () => ({assertOk() {}})}},
  ledger,
  hasPayload: ({blockHash}) => payloads.has(blockHash),
  signer: {
    signExecutionPayloadBid(bid) {
      const t = performance.now();
      const signed = signer.signExecutionPayloadBid(bid);
      signMs += performance.now() - t;
      return signed;
    },
  },
  retainCommitment: async (bid) => {
    const stored = payloads.get("0x" + Buffer.from(bid.message.blockHash).toString("hex"));
    assert(stored);
    startRetainAt = stamp();
    assert.equal(await stage.retainShared(bid, stored, primary.getReference(stored)), "reference");
    endRetainAt = stamp();
    retentionMs = endRetainAt - startRetainAt;
  },
});
const expected = [];
const payloadHashes = {};
let sequence = 0;
const payloadHash = (payload) =>
  createHash("sha256")
    .update(ssz.gloas.ExecutionPayload.serialize(payload.executionPayload))
    .update(ssz.gloas.ExecutionRequests.serialize(payload.executionRequests))
    .update(ssz.gloas.BlobsBundle.serialize(payload.blobsBundle))
    .digest("hex");
try {
  for (const blobs of [0, 4, 8, 12, 21])
    for (let sample = 0; sample < 3; sample++) {
      const slot = 1000 + sequence++;
      const prepared = [];
      for (let revision = 0; revision < 2; revision++) {
        const executionPayload = ssz.gloas.ExecutionPayload.defaultValue();
        executionPayload.slotNumber = slot;
        executionPayload.gasLimit = 30_000_000;
        executionPayload.blockHash = Buffer.alloc(32);
        executionPayload.blockHash.writeUInt32BE(slot * 2 + revision, 28);
        executionPayload.transactions = Array.from({length: 150}, (_, i) => new Uint8Array(400).fill(i));
        executionPayload.blockAccessList = new Uint8Array(50000).fill(1);
        const payload = {
          sourceId: "isolated-reference-profile",
          fork: ForkName.gloas,
          executionPayload,
          executionPayloadValue: BigInt(revision + 1) * 1_000_000_000n,
          executionRequests: ssz.gloas.ExecutionRequests.defaultValue(),
          blobsBundle: {
            blobs: Array.from({length: blobs}, (_, i) => new Uint8Array(131072).fill(i + 1)),
            commitments: Array.from({length: blobs}, (_, i) => new Uint8Array(48).fill(i + 1)),
            proofs: Array.from({length: blobs * 128}, (_, i) => new Uint8Array(48).fill((i % 251) + 1)),
          },
        };
        const bid = createExecutionPayloadBid({
          slot,
          parentBlockRoot: Buffer.alloc(32),
          prevRandao: executionPayload.prevRandao,
          builderIndex: 2,
          feeRecipient: Buffer.alloc(20),
          value: revision + 1,
          payload,
        });
        const stored = {
          slot,
          blockHash: "0x" + Buffer.from(executionPayload.blockHash).toString("hex"),
          parentBlockRoot: bid.parentBlockRoot,
          payload,
        };
        payloadHashes[stored.blockHash] = payloadHash(payload);
        payloads.add(stored);
        await primary.retain(signer.signExecutionPayloadBid(bid), payloads.get(stored.blockHash));
        prepared.push(bid);
      }
      for (const [revision, bid] of prepared.entries()) {
        signMs = 0;
        retentionMs = 0;
        const cpuBefore = cpuStats();
        const start = performance.now();
        const signed = await publisher.prepare(bid);
        const prepareMs = performance.now() - start;
        expected.push(signed);
        while (profiles.length < rows.length + 1) await new Promise((resolve) => setImmediate(resolve));
        const profile = profiles[rows.length];
        assert.equal(profile.kind, "retainReference");
        assert.equal(profile.error, null);
        assert.equal(profile.phases.fileSync.count, 1);
        assert.equal(
          profile.phases.directorySync.count,
          revision === 0 && blobs > 0 ? (variant === "batched" ? 3 : blobs + 2) : 2
        );
        const cpuAfter = cpuStats();
        rows.push({
          blobs,
          sample,
          revision,
          cpuDelta: Object.fromEntries(Object.entries(cpuAfter).map(([key, value]) => [key, value - cpuBefore[key]])),
          prepareMs,
          signMs,
          retainSharedMs: retentionMs,
          enqueueToWorkerMs: profile.startAt - startRetainAt,
          workerMs: profile.finishAt - profile.startAt,
          workerReplyToResumeMs: endRetainAt - profile.finishAt,
          phases: profile.phases,
        });
      }
    }
  await stage.close();
  await primary.close();
  channel.port1.close();
  const recoveredPayloads = new PayloadStore(),
    recoveredBids = new BidStore(),
    recoveredLedger = new BidLedger();
  const recovered = new CommitmentJournal(path.join(directory, "stage"), identity).recover(
    1000,
    recoveredPayloads,
    recoveredBids,
    recoveredLedger
  );
  assert.equal(recovered, expected.length);
  for (const signed of expected) assert(recoveredBids.has(signed));
  for (const [hash, expectedHash] of Object.entries(payloadHashes)) {
    const stored = recoveredPayloads.get(hash);
    assert(stored);
    assert.equal(payloadHash(stored.payload), expectedHash);
  }
  const inodes = new Map();
  function inventory(p) {
    for (const e of fs.readdirSync(p, {withFileTypes: true})) {
      const f = path.join(p, e.name);
      if (e.isDirectory()) inventory(f);
      else {
        const s = fs.statSync(f);
        inodes.set(`${s.dev}:${s.ino}`, s.size);
      }
    }
  }
  inventory(directory);
  const uniqueBytes = [...inodes.values()].reduce((a, b) => a + b, 0);
  assert(uniqueBytes < 32 * 1024 * 1024);
  console.log(
    JSON.stringify({
      node: process.version,
      variant,
      rows,
      recovered,
      uniqueBytes,
      payloadHashes,
      cpuDelta: Object.fromEntries(Object.entries(cpuStats()).map(([key, value]) => [key, value - initialCpu[key]])),
      productionOperationsUnchanged: variant === "baseline",
      syntheticKeysOnly: true,
      liveJournalMounted: false,
      scope:
        "Real journal worker in isolated same-filesystem synthetic profile with syscall timing wrappers; baseline or grouped-blob-barrier candidate selected by the caller. Scheduling/throttling and instrumentation overhead remain included.",
    })
  );
} finally {
  await stage.close();
  await primary.close();
  channel.port1.close();
  fs.rmSync(directory, {recursive: true, force: true});
}
