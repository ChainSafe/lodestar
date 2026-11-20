import {createHash} from "node:crypto";
import {EventEmitter} from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {
  AsyncCommitmentJournal,
  type JournalReply,
  type JournalRequest,
} from "../../../src/services/asyncCommitmentJournal.js";
import {BidLedger} from "../../../src/services/bidLedger.js";
import {BidStore} from "../../../src/services/bidStore.js";
import {CommitmentJournal} from "../../../src/services/commitmentJournal.js";
import {BID_HISTORY_SLOTS, MAX_BID_REVISIONS_PER_SLOT} from "../../../src/services/commitmentLimits.js";
import {OrderExposure, type OrderExposureQuery} from "../../../src/services/orderExposure.js";
import {parseOrderMetadata} from "../../../src/services/orderMetadata.js";
import {PayloadStore} from "../../../src/services/payloadStore.js";
import {mockBuiltPayload} from "../utils/payload.js";

const orderId = `0x${"12".repeat(32)}`;
const otherId = `0x${"34".repeat(32)}`;
const identity = {genesisValidatorsRoot: toRootHex(Buffer.alloc(32, 1)), pubkey: "test"};
const directories: string[] = [];
const threads: Thread[] = [];

class Thread extends EventEmitter {
  readonly pending: JournalRequest[] = [];
  constructor(readonly journal: CommitmentJournal) {
    super();
    threads.push(this);
  }
  postMessage(request: JournalRequest): void {
    this.pending.push(request);
  }
  finish(): void {
    const request = this.pending.shift();
    if (!request) throw Error("Missing journal request");
    const reply: JournalReply = {id: request.id};
    try {
      const operation = request.operation;
      if (operation.kind === "retain") reply.reference = this.journal.retain(operation.bid, operation.stored);
      if (operation.kind === "retainReference") this.journal.retainReference(operation.bid, operation.reference);
      if (operation.kind === "prune") this.journal.prune(operation.slot);
      if (operation.kind === "reveal") this.journal.retainReveal(operation.record);
      if (operation.kind === "exposure")
        reply.exposure = this.journal.queryExposure(operation.orderId, operation.admittedAtUnixMs);
    } catch (error) {
      reply.error = error instanceof Error ? error.message : String(error);
    }
    reply.coverageLost = !this.journal.hasExposureCoverage();
    this.emit("message", reply);
  }
  async terminate(): Promise<number> {
    this.emit("exit", 0);
    return 0;
  }
}

function setup(shared?: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "order-exposure-"));
  directories.push(directory);
  const journal = new CommitmentJournal(directory, identity, undefined, shared);
  const thread = new Thread(journal);
  const worker = new AsyncCommitmentJournal(thread);
  thread.emit("message", {id: 0});
  return {directory, journal, thread, worker};
}

function fixture(index = 0, ids: string[] | null = [orderId]) {
  const payload = {
    ...mockBuiltPayload({slot: 100, valueGwei: 1}),
    orderMetadata: parseOrderMetadata({version: 1, orderIds: ids, doNotOfferBefore: 0}),
  };
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  bid.message.slot = 100;
  bid.message.builderIndex = index;
  bid.message.blockHash = payload.executionPayload.blockHash;
  bid.message.parentBlockHash = payload.executionPayload.parentHash;
  bid.message.executionRequestsRoot = ssz.gloas.ExecutionRequests.hashTreeRoot(payload.executionRequests);
  bid.message.value = 1;
  return {
    bid,
    stored: {
      slot: 100,
      parentBlockRoot: bid.message.parentBlockRoot,
      blockHash: toRootHex(bid.message.blockHash),
      payload,
    },
  };
}

function distinctFixture(index: number, ids: string[] | null, slot = 100) {
  const f = fixture(index, ids);
  const hash = createHash("sha256").update(`exposure-${index}`).digest();
  f.bid.message.slot = slot;
  f.bid.message.blockHash = hash;
  f.stored.slot = slot;
  f.stored.blockHash = toRootHex(hash);
  f.stored.payload.executionPayload.slotNumber = slot;
  f.stored.payload.executionPayload.blockHash = hash;
  return f;
}

function request(exposure: OrderExposure, id = orderId): OrderExposureQuery {
  const capability = exposure.capabilities();
  return {
    version: 1,
    action: "query",
    orderId: id,
    namespace: `0x${"ab".repeat(16)}`,
    generation: "0x1",
    admittedAtUnixMs: capability.observedAtUnixMs,
    admittedPublisherInstance: capability.publisherInstance,
  };
}

afterEach(() => {
  for (const thread of threads.splice(0)) thread.emit("exit", 0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) fs.rmSync(directory, {recursive: true, force: true});
});

describe("order exposure receipts", () => {
  it("keeps receipt coverage after restarting with over ten thousand unexpired bid revisions", async () => {
    vi.useFakeTimers();
    const {directory, worker: previous} = setup();
    await previous.close();
    const count = 10_039;
    const currentSlot = 100 + BID_HISTORY_SLOTS;
    let totalBytes = 0;
    let legacyFilename = "";
    let legacyData: unknown;
    for (let i = 0; i < count; i++) {
      const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
      bid.message.slot = 100 + Math.floor(i / MAX_BID_REVISIONS_PER_SLOT);
      bid.message.value = i + 1;
      bid.message.blobKzgCommitments = Array.from({length: 8}, () => new Uint8Array(48));
      const signedBid = ssz.gloas.SignedExecutionPayloadBid.toJson(bid);
      const data = {
        version: 2,
        signedBid,
        orderMetadata: {version: 1, orderIds: [orderId], doNotOfferBefore: 0},
        possibleExposureAtUnixMs: Date.now(),
      };
      const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(bid));
      const filename = path.join(directory, `bid-${bid.message.slot}-${root}.json`);
      const text = JSON.stringify({
        data,
        checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
      });
      fs.writeFileSync(filename, text);
      totalBytes += Buffer.byteLength(text);
      legacyFilename = filename;
      legacyData = signedBid;
    }
    expect(totalBytes).toBeGreaterThan(16 * 1024 * 1024);
    expect(totalBytes).toBeLessThan(64 * 1024 * 1024);

    const recovered = new CommitmentJournal(directory, identity, currentSlot);
    expect(recovered.recover(currentSlot, new PayloadStore(), new BidStore(), new BidLedger())).toBe(count);
    expect(recovered.hasExposureCoverage()).toBe(true);
    const thread = new Thread(recovered);
    const worker = new AsyncCommitmentJournal(thread);
    thread.emit("message", {id: 0, coverageLost: !recovered.hasExposureCoverage()});
    const exposure = new OrderExposure([worker]);
    expect(exposure.capabilities().ready).toBe(true);
    const absent = exposure.query(request(exposure, otherId));
    thread.finish();
    expect(await absent).toMatchObject({priorCommitmentExposure: "none", coverageComplete: true});
    const positive = exposure.query(request(exposure));
    thread.finish();
    expect(await positive).toMatchObject({
      priorCommitmentExposure: "possible",
      coverageComplete: true,
      commitmentCount: count,
      truncated: true,
    });

    const fresh = distinctFixture(1, [otherId], currentSlot);
    const retained = worker.retain(fresh.bid, fresh.stored);
    thread.finish();
    await retained;
    const offered = exposure.query(request(exposure, otherId));
    thread.finish();
    expect(await offered).toMatchObject({priorCommitmentExposure: "possible", commitmentCount: 1});
    await worker.close();

    fs.writeFileSync(
      legacyFilename,
      JSON.stringify({
        data: legacyData,
        checksum: createHash("sha256").update(JSON.stringify(legacyData)).digest("hex"),
      })
    );
    const legacy = new CommitmentJournal(directory, identity, currentSlot);
    expect(legacy.hasExposureCoverage()).toBe(true);
    expect(legacy.queryExposure(`0x${"56".repeat(32)}`, Date.now())).toMatchObject({
      coverageComplete: false,
      commitmentCount: 0,
    });
    expect(legacy.queryExposure(orderId, Date.now())).toMatchObject({
      coverageComplete: false,
      commitmentCount: count - 1,
    });
    const payloads = new PayloadStore();
    const bids = new BidStore();
    expect(legacy.recover(currentSlot, payloads, bids, new BidLedger())).toBe(count + 1);
    expect(bids.has(fresh.bid)).toBe(true);
    const restored = payloads.get(fresh.stored.blockHash);
    if (!restored) throw Error("Missing recovered payload");
    expect(ssz.gloas.ExecutionPayload.serialize(restored.payload.executionPayload)).toEqual(
      ssz.gloas.ExecutionPayload.serialize(fresh.stored.payload.executionPayload)
    );
  }, 300_000);

  it("keeps the 64 MiB exposure budget fail-closed across append, restart and pruning", () => {
    vi.useFakeTimers();
    const {directory} = setup();
    const ids = [orderId, ...Array.from({length: 255}, (_, i) => `0x${i.toString(16).padStart(64, "0")}`)];
    const maxBytes = 64 * 1024 * 1024;
    let totalBytes = 0;
    let count = 0;
    for (;;) {
      const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
      bid.message.slot = 100 + Math.floor(count / MAX_BID_REVISIONS_PER_SLOT);
      bid.message.value = count + 1;
      const data = {
        version: 2,
        signedBid: ssz.gloas.SignedExecutionPayloadBid.toJson(bid),
        orderMetadata: {version: 1, orderIds: ids, doNotOfferBefore: 0},
        possibleExposureAtUnixMs: Date.now(),
      };
      const text = JSON.stringify({
        data,
        checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex"),
      });
      const bytes = Buffer.byteLength(text);
      expect(bytes, `record ${count}`).toBeLessThan(32 * 1024);
      if (totalBytes + bytes > maxBytes) break;
      const root = toRootHex(ssz.gloas.SignedExecutionPayloadBid.hashTreeRoot(bid));
      fs.writeFileSync(path.join(directory, `bid-${bid.message.slot}-${root}.json`), text);
      totalBytes += bytes;
      count++;
    }
    const currentSlot = 100 + BID_HISTORY_SLOTS;
    const journal = new CommitmentJournal(directory, identity, currentSlot);
    expect(journal.hasExposureCoverage()).toBe(true);
    expect(journal.queryExposure(orderId, Date.now())).toMatchObject({
      coverageComplete: true,
      commitmentCount: count,
    });
    const overflow = distinctFixture(0, ids, currentSlot);
    overflow.bid.message.value = Number.MAX_SAFE_INTEGER;
    journal.retain(overflow.bid, overflow.stored);
    expect(journal.hasExposureCoverage()).toBe(false);
    expect(journal.queryExposure(otherId, Date.now()).coverageComplete).toBe(false);
    const recovered = new CommitmentJournal(directory, identity, currentSlot);
    expect(recovered.hasExposureCoverage()).toBe(false);
    expect(recovered.queryExposure(otherId, Date.now()).coverageComplete).toBe(false);
    recovered.prune(currentSlot + BID_HISTORY_SLOTS + 1);
    vi.advanceTimersByTime(1000);
    for (const instance of [journal, recovered]) {
      expect(instance.hasExposureCoverage()).toBe(false);
      expect(instance.queryExposure(otherId, Date.now()).coverageComplete).toBe(false);
    }
    const fresh = distinctFixture(1, [otherId], currentSlot + BID_HISTORY_SLOTS + 1);
    recovered.retain(fresh.bid, fresh.stored);
    expect(recovered.queryExposure(otherId, Date.now())).toMatchObject({
      coverageComplete: false,
      commitmentCount: 1,
    });
  });

  it("waits for primary and staged durable writes, including shared payload references", async () => {
    const primary = setup();
    const staged = setup(primary.directory);
    const exposure = new OrderExposure([primary.worker, staged.worker]);
    const query = request(exposure);
    const first = fixture();
    const retained = primary.worker.retain(first.bid, first.stored);
    primary.thread.finish();
    await retained;
    const second = fixture(9);
    const stagedWrite = staged.worker.retainShared(
      second.bid,
      second.stored,
      primary.worker.getReference(first.stored)
    );
    const receipt = exposure.query(query);
    primary.thread.finish();
    expect(staged.thread.pending[0].operation.kind).toBe("retainReference");
    staged.thread.finish();
    await stagedWrite;
    await Promise.resolve();
    staged.thread.finish();
    expect(await receipt).toMatchObject({
      orderId,
      namespace: query.namespace,
      generation: query.generation,
      barrierComplete: true,
      coverageComplete: true,
      priorCommitmentExposure: "possible",
      commitmentCount: 2,
      commitments: [{builderIndex: 0}, {builderIndex: 9}],
    });
    const recovered = new CommitmentJournal(staged.directory, identity);
    const payloads = new PayloadStore();
    expect(recovered.recover(100, payloads, new BidStore(), new BidLedger())).toBe(1);
    expect(payloads.get(first.stored.blockHash)?.payload.orderMetadata).toEqual(first.stored.payload.orderMetadata);
    expect(recovered.queryExposure(orderId, query.admittedAtUnixMs).commitmentCount).toBe(1);
    await primary.worker.close();
    await staged.worker.close();
  });

  it("proves none only for the same continuous instance after every barrier", async () => {
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const query = request(exposure);
    const receipt = exposure.query(query);
    primary.thread.finish();
    expect(await receipt).toMatchObject({priorCommitmentExposure: "none", coverageComplete: true});
    for (const changed of [
      {...query, admittedPublisherInstance: "previous"},
      {...query, admittedAtUnixMs: exposure.capabilities().coverageSinceUnixMs - 1},
      {...query, admittedAtUnixMs: Date.now() + 60_000},
    ]) {
      const result = exposure.query(changed);
      primary.thread.finish();
      expect(await result).toMatchObject({priorCommitmentExposure: "unknown", coverageComplete: false});
    }
    await primary.worker.close();
  });

  it("covers a shared-retention fallback enqueued after its reference reply", async () => {
    const primary = setup();
    const staged = setup(primary.directory);
    const f = fixture();
    const first = primary.worker.retain(f.bid, f.stored);
    primary.thread.finish();
    await first;
    const reference = primary.worker.getReference(f.stored);
    if (!reference) throw Error("Missing durable reference");
    fs.unlinkSync(path.join(primary.directory, reference.files[0].name));
    const exposure = new OrderExposure([staged.worker]);
    const q = request(exposure);
    const second = fixture(9);
    const write = staged.worker.retainShared(second.bid, second.stored, reference);
    const result = exposure.query(q);
    for (let turn = 0; turn < 10; turn++) {
      await Promise.resolve();
      await Promise.resolve();
      if (staged.thread.pending.length > 0) staged.thread.finish();
    }
    expect(await write).toBe("snapshot");
    expect(await result).toMatchObject({priorCommitmentExposure: "possible", commitmentCount: 1});
    await primary.worker.close();
    await staged.worker.close();
  });

  it("bounds an unfinished shared fallback without allowing repeated abandoned barriers", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const staged = setup(primary.directory);
    const f = fixture();
    const first = primary.worker.retain(f.bid, f.stored);
    primary.thread.finish();
    await first;
    const reference = primary.worker.getReference(f.stored);
    if (!reference) throw Error("Missing durable reference");
    fs.unlinkSync(path.join(primary.directory, reference.files[0].name));
    const exposure = new OrderExposure([staged.worker]);
    const q = request(exposure);
    const second = fixture(9);
    const write = staged.worker.retainShared(second.bid, second.stored, reference);
    const result = exposure.query(q);
    staged.thread.finish();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({priorCommitmentExposure: "unknown", barrierComplete: false});
    await expect(exposure.query(q)).rejects.toThrow("ORDER_EXPOSURE_BUSY");
    expect(staged.thread.pending).toHaveLength(1);
    expect(staged.thread.pending[0].operation.kind).toBe("retain");
    staged.thread.finish();
    await write;
    await vi.advanceTimersByTimeAsync(0);
    staged.thread.finish();
    await vi.advanceTimersByTimeAsync(0);
    const later = exposure.query(q);
    staged.thread.finish();
    expect(await later).toMatchObject({priorCommitmentExposure: "possible", commitmentCount: 1});
    await primary.worker.close();
    await staged.worker.close();
  });

  it("uses a publisher-clock admission lower bound and searches commitments older than it", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const f = fixture();
    primary.journal.retain(f.bid, f.stored);
    await vi.advanceTimersByTimeAsync(10);
    const q = request(exposure);
    const publisherTime = Date.now();
    const gatewayTime = publisherTime + 60_000;
    expect(q.admittedAtUnixMs).toBe(publisherTime);
    expect(q.admittedAtUnixMs).not.toBe(gatewayTime);
    const positive = exposure.query(q);
    primary.thread.finish();
    expect(await positive).toMatchObject({priorCommitmentExposure: "possible", commitmentCount: 1});
    const none = exposure.query({...q, orderId: otherId});
    primary.thread.finish();
    expect(await none).toMatchObject({priorCommitmentExposure: "none", coverageComplete: true});
    primary.journal.prune(100 + BID_HISTORY_SLOTS + 1);
    const oldBound = {...q, admittedAtUnixMs: publisherTime - 10};
    const pruned = exposure.query(oldBound);
    primary.thread.finish();
    expect(await pruned).toMatchObject({priorCommitmentExposure: "unknown", coverageComplete: false});
    await primary.worker.close();
  });

  it("never proves absence for unknown membership, legacy recovery or pruned history", () => {
    const first = setup();
    const unknown = fixture(0, null);
    first.journal.retain(unknown.bid, unknown.stored);
    expect(first.journal.queryExposure(otherId, Date.now()).coverageComplete).toBe(false);
    const second = setup();
    const known = fixture();
    const time = Date.now();
    second.journal.retain(known.bid, known.stored);
    second.journal.prune(100 + BID_HISTORY_SLOTS + 1);
    expect(second.journal.queryExposure(orderId, time)).toMatchObject({coverageComplete: false, commitmentCount: 0});
    const legacy = fixture();
    delete legacy.stored.payload.orderMetadata;
    const third = setup();
    third.journal.retain(legacy.bid, legacy.stored);
    const recovered = new CommitmentJournal(third.directory, identity);
    expect(recovered.queryExposure(orderId, time).coverageComplete).toBe(false);
  });

  it.each([{ids: []}, {ids: [otherId]}])(
    "preserves absence across sixty seconds of unrelated pruning: $ids",
    async ({ids}) => {
      vi.useFakeTimers();
      const primary = setup();
      const staged = setup();
      const exposure = new OrderExposure([primary.worker, staged.worker]);
      const q = request(exposure);
      for (let i = 0; i < 5; i++) {
        const f = distinctFixture(i, ids, 100 + i);
        primary.journal.retain(f.bid, f.stored);
        staged.journal.retain(f.bid, f.stored);
        await vi.advanceTimersByTimeAsync(12_000);
        primary.journal.prune(101 + i + BID_HISTORY_SLOTS);
        staged.journal.prune(101 + i + BID_HISTORY_SLOTS);
        const result = exposure.query(q);
        primary.thread.finish();
        staged.thread.finish();
        expect(await result, `prune ${i}`).toMatchObject({
          priorCommitmentExposure: "none",
          coverageComplete: true,
          commitmentCount: 0,
          commitments: [],
        });
      }
      await primary.worker.close();
      await staged.worker.close();
    }
  );

  it("keeps forgotten matching IDs unknown even with a later bound without inventing positives", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const f = fixture();
    primary.journal.retain(f.bid, f.stored);
    await vi.advanceTimersByTimeAsync(1000);
    primary.journal.prune(101 + BID_HISTORY_SLOTS);
    await vi.advanceTimersByTimeAsync(1000);
    const result = exposure.query(request(exposure));
    primary.thread.finish();
    expect(await result).toMatchObject({
      priorCommitmentExposure: "unknown",
      coverageComplete: false,
      commitmentCount: 0,
      commitments: [],
      earliestPossibleOfferAtUnixMs: null,
      truncated: false,
    });
    const later = distinctFixture(1, [orderId], 102);
    primary.journal.retain(later.bid, later.stored);
    const positive = exposure.query(request(exposure));
    primary.thread.finish();
    expect(await positive).toMatchObject({priorCommitmentExposure: "possible", commitmentCount: 1});
    await primary.worker.close();
  });

  it("bounds forgotten IDs at 8192, does not charge duplicates and makes overflow sticky", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const {journal} = primary;
    const exposure = new OrderExposure([primary.worker]);
    const q = request(exposure);
    const admitted = Date.now();
    const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
    for (let i = 0; i < 32; i++) {
      const f = distinctFixture(
        i,
        Array.from({length: 256}, (_, n) => id(i * 256 + n)),
        100 + i
      );
      journal.retain(f.bid, f.stored);
      journal.prune(101 + i + BID_HISTORY_SLOTS);
      expect(journal.queryExposure(otherId, admitted).coverageComplete, `batch ${i}`).toBe(true);
    }
    const duplicate = distinctFixture(32, [id(0), id(8191)], 132);
    journal.retain(duplicate.bid, duplicate.stored);
    journal.prune(133 + BID_HISTORY_SLOTS);
    expect(journal.hasExposureCoverage()).toBe(true);
    expect(journal.queryExposure(otherId, admitted).coverageComplete).toBe(true);

    const overflow = distinctFixture(33, [id(8192)], 133);
    journal.retain(overflow.bid, overflow.stored);
    journal.prune(134 + BID_HISTORY_SLOTS);
    expect(journal.hasExposureCoverage()).toBe(false);
    vi.advanceTimersByTime(60_000);
    journal.prune(200 + BID_HISTORY_SLOTS);
    for (const queried of [id(0), id(8191), id(8192), otherId]) {
      expect(journal.queryExposure(queried, Date.now()), queried).toMatchObject({
        coverageComplete: false,
        commitmentCount: 0,
        commitments: [],
      });
    }
    const unknown = exposure.query({...q, orderId: id(0), admittedAtUnixMs: Date.now()});
    primary.thread.finish();
    expect(await unknown).toMatchObject({priorCommitmentExposure: "unknown", coverageComplete: false});
    expect(exposure.capabilities()).toMatchObject({ready: false});
    expect(exposure.capabilities().publisherInstance).not.toBe(q.admittedPublisherInstance);
    const retained = distinctFixture(34, [id(0)], 300);
    journal.retain(retained.bid, retained.stored);
    const positive = exposure.query({...q, orderId: id(0), admittedAtUnixMs: Date.now()});
    primary.thread.finish();
    expect(await positive).toMatchObject({
      priorCommitmentExposure: "possible",
      coverageComplete: false,
      commitmentCount: 1,
    });
    await primary.worker.close();
  });

  it("does not clear unknown membership's global barrier when a known record is later pruned", () => {
    vi.useFakeTimers();
    const {journal} = setup();
    const admitted = Date.now();
    const unknown = distinctFixture(0, null);
    journal.retain(unknown.bid, unknown.stored);
    vi.advanceTimersByTime(1000);
    journal.prune(101 + BID_HISTORY_SLOTS);
    vi.advanceTimersByTime(1000);
    const known = distinctFixture(1, [], 102);
    journal.retain(known.bid, known.stored);
    journal.prune(103 + BID_HISTORY_SLOTS);
    expect(journal.queryExposure(otherId, admitted).coverageComplete).toBe(false);
    expect(journal.queryExposure(otherId, Date.now()).coverageComplete).toBe(true);
  });

  it("does not turn a forgotten old-instance admission into absence after restart", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const before = new OrderExposure([primary.worker]);
    const q = request(before);
    const f = fixture();
    primary.journal.retain(f.bid, f.stored);
    primary.journal.prune(101 + BID_HISTORY_SLOTS);
    await primary.worker.close();
    await vi.advanceTimersByTimeAsync(1000);
    const recovered = new CommitmentJournal(primary.directory, identity);
    const thread = new Thread(recovered);
    const worker = new AsyncCommitmentJournal(thread);
    thread.emit("message", {id: 0});
    const after = new OrderExposure([worker]);
    expect(after.capabilities().publisherInstance).not.toBe(q.admittedPublisherInstance);
    const result = after.query({...q, admittedAtUnixMs: Date.now()});
    thread.finish();
    expect(await result).toMatchObject({priorCommitmentExposure: "unknown", coverageComplete: false});
    await worker.close();
  });

  it("keeps forgotten membership conservative when the bid file cannot be removed", () => {
    vi.useFakeTimers();
    const {journal} = setup();
    const f = fixture();
    const admitted = Date.now();
    journal.retain(f.bid, f.stored);
    const unlink = fs.unlinkSync;
    const removal = vi.spyOn(fs, "unlinkSync").mockImplementation((name) => {
      if (path.basename(String(name)).startsWith("bid-")) throw Error("injected prune failure");
      unlink(name);
    });
    expect(() => journal.prune(101 + BID_HISTORY_SLOTS)).toThrow("injected prune failure");
    removal.mockRestore();
    vi.advanceTimersByTime(1000);
    expect(journal.queryExposure(orderId, Date.now())).toMatchObject({coverageComplete: false, commitmentCount: 0});
    journal.prune(101 + BID_HISTORY_SLOTS);
    expect(journal.queryExposure(otherId, admitted).coverageComplete).toBe(false);
  });

  it("retains separate immutable admissions for identical signed bytes before and after restart", () => {
    vi.useFakeTimers();
    const {journal, directory} = setup();
    const old = fixture();
    journal.retain(old.bid, old.stored);
    const before = new Map(
      fs.readdirSync(directory).map((name) => [name, fs.readFileSync(path.join(directory, name))])
    );
    const firstTime = journal.queryExposure(orderId, Date.now()).commitments[0].possibleExposureAtUnixMs;
    vi.advanceTimersByTime(25);
    const changed = fixture(0, [otherId]);
    journal.retain(changed.bid, changed.stored);
    journal.retain(changed.bid, changed.stored);
    expect(fs.readdirSync(directory).length).toBe(before.size + 1);
    for (const [name, bytes] of before) expect(fs.readFileSync(path.join(directory, name))).toEqual(bytes);
    const restored = new CommitmentJournal(directory, identity);
    restored.retain(changed.bid, changed.stored);
    expect(fs.readdirSync(directory).length).toBe(before.size + 1);
    for (const current of [journal, restored]) {
      const first = current.queryExposure(orderId, Date.now());
      const second = current.queryExposure(otherId, Date.now());
      expect(first).toMatchObject({coverageComplete: true, commitmentCount: 1});
      expect(second).toMatchObject({coverageComplete: true, commitmentCount: 1});
      expect(first.commitments[0].possibleExposureAtUnixMs).toBe(firstTime);
      expect(second.commitments[0].possibleExposureAtUnixMs).toBe(firstTime + 25);
      expect(first.commitments[0].signedBidRoot).toBe(second.commitments[0].signedBidRoot);
    }
    const store = new PayloadStore();
    const bids = new BidStore();
    const ledger = new BidLedger();
    expect(restored.recover(100, store, bids, ledger)).toBe(2);
    expect(ledger.getRevisionCount(100)).toBe(1);
    expect(bids.has(old.bid)).toBe(true);
    expect(bids.canOffer(old.bid)).toBe(false);
    expect(store.get(old.stored.blockHash)?.payload.orderMetadata?.orderIds).toEqual([orderId]);
  });

  it("shares one immutable payload file across identities with separate admission membership", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const staged = setup(primary.directory);
    const store = new PayloadStore();
    const old = fixture();
    const oldStored = store.add(old.stored);
    const first = primary.worker.retain(old.bid, oldStored);
    primary.thread.finish();
    await first;
    const oldReference = primary.worker.getReference(oldStored);
    if (!oldReference) throw Error("Missing first reference");
    const firstBytes = fs.readFileSync(path.join(primary.directory, oldReference.files[0].name));
    const next = fixture(9, [otherId]);
    const nextStored = store.add(next.stored);
    const nextReference = primary.worker.getReference(nextStored);
    expect(nextReference?.orderMetadata?.orderIds).toEqual([otherId]);
    expect(oldReference.orderMetadata?.orderIds).toEqual([orderId]);
    const retained = staged.worker.retainShared(next.bid, nextStored, nextReference);
    staged.thread.finish();
    expect(await retained).toBe("reference");
    expect(fs.readFileSync(path.join(staged.directory, oldReference.files[0].name))).toEqual(firstBytes);
    expect(fs.statSync(path.join(staged.directory, oldReference.files[0].name)).ino).toBe(
      fs.statSync(path.join(primary.directory, oldReference.files[0].name)).ino
    );
    expect(staged.journal.queryExposure(orderId, Date.now()).commitmentCount).toBe(0);
    expect(staged.journal.queryExposure(otherId, Date.now()).commitmentCount).toBe(1);
    const recovered = new CommitmentJournal(staged.directory, identity);
    expect(recovered.recover(100, new PayloadStore(), new BidStore(), new BidLedger())).toBe(1);
    expect(recovered.queryExposure(otherId, Date.now()).commitmentCount).toBe(1);
    await primary.worker.close();
    await staged.worker.close();
  });

  it("does not offer new ownership before its floor or erase unknown historical attribution", () => {
    vi.useFakeTimers();
    const {journal, directory} = setup();
    const old = fixture(0, null);
    journal.retain(old.bid, old.stored);
    const next = fixture(0, [otherId]);
    next.stored.payload.orderMetadata = parseOrderMetadata({
      version: 1,
      orderIds: [otherId],
      doNotOfferBefore: Date.now() + 100,
    });
    expect(() => journal.retain(next.bid, next.stored)).toThrow("ORDER_OFFER_TOO_EARLY");
    expect(journal.queryExposure(otherId, Date.now())).toMatchObject({coverageComplete: false, commitmentCount: 0});
    vi.advanceTimersByTime(100);
    journal.retain(next.bid, next.stored);
    const restored = new CommitmentJournal(directory, identity);
    expect(restored.queryExposure(otherId, Date.now())).toMatchObject({coverageComplete: false, commitmentCount: 1});
  });

  it("rejects a v3 admission whose key no longer matches its membership", () => {
    const {journal, directory} = setup();
    const old = fixture();
    journal.retain(old.bid, old.stored);
    const next = fixture(0, [otherId]);
    journal.retain(next.bid, next.stored);
    for (const name of fs.readdirSync(directory).filter((name) => name.startsWith("bid-"))) {
      const filename = path.join(directory, name);
      const record = JSON.parse(fs.readFileSync(filename, "utf8"));
      if (record.data.version !== 3) continue;
      record.data.orderMetadata.orderIds = [orderId];
      record.checksum = createHash("sha256").update(JSON.stringify(record.data)).digest("hex");
      fs.writeFileSync(filename, JSON.stringify(record));
    }
    expect(() => new CommitmentJournal(directory, identity)).toThrow("COMMITMENT_BID_MISMATCH");
  });

  it.each([undefined, 2, 4])("recovers legacy and v2 bids but rejects unknown version %s", (version) => {
    const {journal, directory} = setup();
    const f = fixture();
    journal.retain(f.bid, f.stored);
    const name = fs.readdirSync(directory).find((name) => name.startsWith("bid-"));
    if (!name) throw Error("Missing bid record");
    const signedBid = ssz.gloas.SignedExecutionPayloadBid.toJson(f.bid);
    const data =
      version === undefined
        ? signedBid
        : {version, signedBid, orderMetadata: f.stored.payload.orderMetadata, possibleExposureAtUnixMs: Date.now()};
    fs.writeFileSync(
      path.join(directory, name),
      JSON.stringify({data, checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex")})
    );
    if (version === 4) {
      expect(() => new CommitmentJournal(directory, identity)).toThrow("COMMITMENT_BID_UNSUPPORTED_VERSION");
    } else {
      const restored = new CommitmentJournal(directory, identity);
      const bids = new BidStore();
      expect(restored.recover(100, new PayloadStore(), bids, new BidLedger())).toBe(1);
      expect(bids.has(f.bid)).toBe(true);
      expect(restored.queryExposure(orderId, Date.now())).toMatchObject({
        coverageComplete: version === 2,
        commitmentCount: version === 2 ? 1 : 0,
      });
    }
  });

  it("bounds all same-signature admission files per slot across restart and keeps old reveals", () => {
    const {journal, directory} = setup();
    const f = fixture();
    for (let i = 0; i < MAX_BID_REVISIONS_PER_SLOT; i++) {
      const current = fixture(0, [`0x${i.toString(16).padStart(64, "0")}`]);
      journal.retain(current.bid, current.stored);
    }
    const next = fixture(0, [otherId]);
    expect(() => journal.retain(next.bid, next.stored)).toThrow("COMMITMENT_SLOT_ADMISSION_LIMIT");
    const restored = new CommitmentJournal(directory, identity);
    expect(() => restored.retain(next.bid, next.stored)).toThrow("COMMITMENT_SLOT_ADMISSION_LIMIT");
    const firstId = `0x${"00".repeat(32)}`;
    const first = fixture(0, [firstId]);
    expect(() => restored.retain(first.bid, first.stored)).not.toThrow();
    const payloads = new PayloadStore();
    const ledger = new BidLedger();
    expect(restored.recover(100, payloads, new BidStore(), ledger)).toBe(MAX_BID_REVISIONS_PER_SLOT);
    expect(ledger.getRevisionCount(100)).toBe(1);
    expect(payloads.has(f.stored.blockHash)).toBe(true);
    expect(restored.queryExposure(firstId, Date.now()).commitmentCount).toBe(1);
  });

  it("keeps async exposure healthy after a recovered admission cap rejects before any write", async () => {
    const primary = setup();
    for (let i = 0; i < MAX_BID_REVISIONS_PER_SLOT; i++) {
      const f = fixture(0, [`0x${i.toString(16).padStart(64, "0")}`]);
      primary.journal.retain(f.bid, f.stored);
    }
    const restored = new CommitmentJournal(primary.directory, identity);
    const thread = new Thread(restored);
    const worker = new AsyncCommitmentJournal(thread);
    thread.emit("message", {id: 0});
    const names = fs.readdirSync(primary.directory).sort();
    const fresh = distinctFixture(1234, [otherId]);
    const refused = worker.retain(fresh.bid, fresh.stored);
    thread.finish();
    await expect(refused).rejects.toMatchObject({message: "COMMITMENT_SLOT_ADMISSION_LIMIT", uncertain: false});
    expect(worker.isHealthy()).toBe(true);
    expect(fs.readdirSync(primary.directory).sort()).toEqual(names);
    const original = fixture(0, [`0x${"00".repeat(32)}`]);
    const retry = worker.retain(original.bid, original.stored);
    thread.finish();
    await retry;
    const next = distinctFixture(1235, [otherId], 101);
    const admitted = worker.retain(next.bid, next.stored);
    thread.finish();
    await admitted;
    const exposure = worker.queryExposure(otherId, Date.now());
    thread.finish();
    expect(await exposure).toMatchObject({coverageComplete: true, commitmentCount: 1});
    expect(worker.isHealthy()).toBe(true);
    await worker.close();
  });

  it("returns unknown on a bounded wait, then preserves a late durable positive", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const query = request(exposure);
    const f = fixture();
    const write = primary.worker.retain(f.bid, f.stored);
    const first = exposure.query(query);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await first).toMatchObject({priorCommitmentExposure: "unknown", barrierComplete: false});
    primary.thread.finish();
    await write;
    primary.thread.finish();
    await vi.advanceTimersByTimeAsync(0);
    const second = exposure.query(query);
    primary.thread.finish();
    expect(await second).toMatchObject({priorCommitmentExposure: "possible", commitmentCount: 1});
    await primary.worker.close();
  });

  it("keeps a completed positive when another identity's barrier times out", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const staged = setup();
    const exposure = new OrderExposure([primary.worker, staged.worker]);
    const q = request(exposure);
    const f = fixture();
    primary.journal.retain(f.bid, f.stored);
    const result = exposure.query(q);
    primary.thread.finish();
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({
      priorCommitmentExposure: "possible",
      commitmentCount: 1,
      barrierComplete: false,
      coverageComplete: false,
    });
    staged.thread.finish();
    await primary.worker.close();
    await staged.worker.close();
  });

  it("keeps timed-out queries bounded without consuming existing reveal headroom", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const q = request(exposure);
    const f = fixture();
    const write = primary.worker.retain(f.bid, f.stored);
    const result = exposure.query(q);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toMatchObject({priorCommitmentExposure: "unknown"});
    for (let i = 0; i < 20; i++) await expect(exposure.query(q)).rejects.toThrow("ORDER_EXPOSURE_BUSY");
    const reveals = Array.from({length: 15}, (_, i) =>
      primary.worker.retainReveal({
        slot: 100,
        blockRoot: toRootHex(Buffer.alloc(32, i + 1)),
        blockHash: f.stored.blockHash,
        envelopeRoot: toRootHex(Buffer.alloc(32, i + 1)),
      })
    );
    const completed = Promise.all(reveals);
    primary.thread.finish();
    await write;
    for (let i = 0; i < 15; i++) {
      expect(primary.thread.pending[0].operation.kind).toBe("reveal");
      primary.thread.finish();
    }
    await completed;
    expect(primary.thread.pending[0].operation.kind).toBe("exposure");
    primary.thread.finish();
    await vi.advanceTimersByTimeAsync(0);
    await primary.worker.close();
  });

  it("invalidates absence after a forward clock discontinuity", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const q = request(exposure);
    vi.setSystemTime(Date.now() + 10_000);
    const capability = exposure.capabilities();
    expect(capability.ready).toBe(false);
    expect(capability.publisherInstance).not.toBe(q.admittedPublisherInstance);
    const result = exposure.query(q);
    primary.thread.finish();
    expect(await result).toMatchObject({priorCommitmentExposure: "unknown", coverageComplete: false});
    await primary.worker.close();
  });

  it("never proves absence after an idle subsecond rollback, restoration and pruning", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    await vi.advanceTimersByTimeAsync(2000);
    const q = request(exposure);
    const f = fixture();
    vi.setSystemTime(Date.now() - 500);
    primary.journal.retain(f.bid, f.stored);
    vi.setSystemTime(Date.now() + 500);
    expect(primary.journal.queryExposure(orderId, q.admittedAtUnixMs).commitmentCount).toBe(1);
    primary.journal.prune(100 + BID_HISTORY_SLOTS + 1);
    const result = exposure.query(q);
    primary.thread.finish();
    expect(await result).toMatchObject({priorCommitmentExposure: "unknown", coverageComplete: false});
    await primary.worker.close();
  });

  it("covers clock rounding at prune even when the adjustment is below the tolerance", () => {
    vi.useFakeTimers();
    const primary = setup();
    const f = fixture();
    const admitted = Date.now();
    vi.setSystemTime(admitted - 1);
    primary.journal.retain(f.bid, f.stored);
    primary.journal.prune(100 + BID_HISTORY_SLOTS + 1);
    vi.setSystemTime(admitted);
    expect(primary.journal.queryExposure(orderId, admitted).coverageComplete).toBe(false);
  });

  it("changes instance and refuses absence after clock rollback or a missing identity", async () => {
    vi.useFakeTimers();
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const first = exposure.capabilities();
    vi.setSystemTime(Date.now() - 1);
    const next = exposure.capabilities();
    expect(next.ready).toBe(false);
    expect(next.publisherInstance).not.toBe(first.publisherInstance);
    expect(new OrderExposure([primary.worker, undefined]).capabilities().ready).toBe(false);
    await primary.worker.close();
  });

  it("rejects too-early persistence and permits the exact not-before boundary", () => {
    vi.useFakeTimers();
    const {journal} = setup();
    const f = fixture();
    f.stored.payload.orderMetadata = parseOrderMetadata({
      version: 1,
      orderIds: [orderId],
      doNotOfferBefore: Date.now() + 1,
    });
    expect(() => journal.retain(f.bid, f.stored)).toThrow("ORDER_OFFER_TOO_EARLY");
    vi.setSystemTime(Date.now() + 1);
    journal.retain(f.bid, f.stored);
    expect(journal.queryExposure(orderId, Date.now()).commitmentCount).toBe(1);
    vi.setSystemTime(Date.now() - 1);
    expect(() => journal.retain(f.bid, f.stored)).toThrow("ORDER_OFFER_TOO_EARLY");
  });

  it("bounds returned evidence while preserving the full known count", async () => {
    const primary = setup();
    const exposure = new OrderExposure([primary.worker]);
    const q = request(exposure);
    const f = fixture();
    for (let value = 1; value <= 70; value++) {
      const bid = structuredClone(f.bid);
      bid.message.value = value;
      primary.journal.retain(bid, f.stored);
    }
    const result = exposure.query(q);
    primary.thread.finish();
    const receipt = await result;
    expect(receipt.priorCommitmentExposure).toBe("possible");
    expect(receipt.commitmentCount).toBe(70);
    expect(receipt.commitments).toHaveLength(64);
    expect(receipt.truncated).toBe(true);
    await primary.worker.close();
  });

  it("recovers a possible commitment after its final directory sync failed", () => {
    const {journal, directory} = setup();
    const f = fixture();
    const rename = fs.renameSync;
    const sync = fs.fsyncSync;
    let bidRenamed = false;
    const renaming = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      rename(from, to);
      if (String(to).includes("/bid-")) bidRenamed = true;
    });
    const syncing = vi.spyOn(fs, "fsyncSync").mockImplementation((fd) => {
      if (bidRenamed) throw Error("injected bid directory sync failure");
      sync(fd);
    });
    expect(() => journal.retain(f.bid, f.stored)).toThrow("injected bid directory sync failure");
    expect(journal.queryExposure(orderId, Date.now()).coverageComplete).toBe(false);
    renaming.mockRestore();
    syncing.mockRestore();
    const recovered = new CommitmentJournal(directory, identity);
    expect(recovered.queryExposure(orderId, Date.now()).commitmentCount).toBe(1);
    expect(recovered.recover(100, new PayloadStore(), new BidStore(), new BidLedger())).toBe(1);
  });

  it.each(["legacy", "unsupported metadata", "missing timestamp"] as const)(
    "retains historical reveals but refuses absence after %s recovery",
    (format) => {
      vi.useFakeTimers();
      const {journal, directory} = setup();
      const admitted = Date.now();
      const f = fixture();
      journal.retain(f.bid, f.stored);
      const bidName = fs.readdirSync(directory).find((name) => name.startsWith("bid-"));
      if (!bidName) throw Error("Missing committed bid");
      const filename = path.join(directory, bidName);
      const record = JSON.parse(fs.readFileSync(filename, "utf8"));
      const data = format === "legacy" ? record.data.signedBid : record.data;
      if (format === "unsupported metadata") data.orderMetadata = {version: 99, orderIds: [], doNotOfferBefore: 0};
      if (format === "missing timestamp") delete data.possibleExposureAtUnixMs;
      fs.writeFileSync(
        filename,
        JSON.stringify({data, checksum: createHash("sha256").update(JSON.stringify(data)).digest("hex")})
      );
      const recovered = new CommitmentJournal(directory, identity);
      expect(recovered.queryExposure(otherId, Date.now()).coverageComplete).toBe(false);
      const payloads = new PayloadStore();
      const bids = new BidStore();
      expect(recovered.recover(100, payloads, bids, new BidLedger())).toBe(1);
      expect(bids.has(f.bid)).toBe(true);
      const restored = payloads.get(f.stored.blockHash);
      if (!restored) throw Error("Missing recovered payload");
      expect(ssz.gloas.ExecutionPayload.serialize(restored.payload.executionPayload)).toEqual(
        ssz.gloas.ExecutionPayload.serialize(f.stored.payload.executionPayload)
      );
      vi.advanceTimersByTime(1000);
      recovered.prune(101 + BID_HISTORY_SLOTS);
      vi.advanceTimersByTime(1000);
      expect(recovered.queryExposure(otherId, admitted)).toMatchObject({coverageComplete: false, commitmentCount: 0});
    }
  );

  it("preserves a positive membership with unknown exposure time without inventing evidence", async () => {
    const primary = setup();
    const f = fixture();
    primary.journal.retain(f.bid, f.stored);
    const bidName = fs.readdirSync(primary.directory).find((name) => name.startsWith("bid-"));
    if (!bidName) throw Error("Missing committed bid");
    const filename = path.join(primary.directory, bidName);
    const record = JSON.parse(fs.readFileSync(filename, "utf8"));
    delete record.data.possibleExposureAtUnixMs;
    fs.writeFileSync(
      filename,
      JSON.stringify({
        data: record.data,
        checksum: createHash("sha256").update(JSON.stringify(record.data)).digest("hex"),
      })
    );
    const restored = new CommitmentJournal(primary.directory, identity);
    const thread = new Thread(restored);
    const worker = new AsyncCommitmentJournal(thread);
    thread.emit("message", {id: 0});
    const exposure = new OrderExposure([worker]);
    const result = exposure.query(request(exposure));
    thread.finish();
    expect(await result).toMatchObject({
      priorCommitmentExposure: "possible",
      commitmentCount: 1,
      commitments: [],
      earliestPossibleOfferAtUnixMs: null,
      coverageComplete: false,
      truncated: true,
    });
    await worker.close();
  });
});
