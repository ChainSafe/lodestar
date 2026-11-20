import {EventEmitter} from "node:events";
import {describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {AsyncCommitmentJournal, type JournalRequest} from "../../../src/services/asyncCommitmentJournal.js";
import {mockBuiltPayload} from "../utils/payload.js";

class Thread extends EventEmitter {
  readonly sent: JournalRequest[] = [];
  postMessage(request: JournalRequest): void {
    this.sent.push(request);
  }
  async terminate(): Promise<number> {
    this.emit("exit", 0);
    return 0;
  }
  finish(error?: string): void {
    this.emit("message", {id: this.sent.at(-1)?.id, error});
  }
}

function setup() {
  const thread = new Thread();
  const journal = new AsyncCommitmentJournal(thread);
  thread.emit("message", {id: 0});
  const bid = ssz.gloas.SignedExecutionPayloadBid.defaultValue();
  const payload = mockBuiltPayload();
  const stored = {
    slot: 1,
    parentBlockRoot: new Uint8Array(32),
    blockHash: toRootHex(payload.executionPayload.blockHash),
    payload,
  };
  return {thread, journal, bid, stored};
}

describe("AsyncCommitmentJournal", () => {
  it("admits alternate retention only while the initialized journal is idle", async () => {
    const thread = new Thread();
    const journal = new AsyncCommitmentJournal(thread);
    expect(journal.canRetainAlternate()).toBe(false);
    thread.emit("message", {id: 0});
    expect(journal.canRetainAlternate()).toBe(true);
    const {bid, stored} = setup();
    const offer = journal.retain(bid, stored);
    expect(journal.canRetainAlternate()).toBe(false);
    const queued = journal.prune(2);
    thread.finish();
    await offer;
    expect(journal.canRetainAlternate()).toBe(false);
    thread.finish();
    await queued;
    expect(journal.canRetainAlternate()).toBe(true);
    await journal.close();
    expect(journal.canRetainAlternate()).toBe(false);
  });

  it("falls back to the retained snapshot only when reference linking is unavailable", async () => {
    const {thread, journal, bid, stored} = setup();
    const reference = {
      slot: 1,
      blockHash: stored.blockHash,
      parentBlockRoot: toRootHex(stored.parentBlockRoot),
      parentBlockHash: toRootHex(stored.payload.executionPayload.parentHash),
      executionRequestsRoot: toRootHex(ssz.gloas.ExecutionRequests.hashTreeRoot(stored.payload.executionRequests)),
      commitments: [],
      files: [],
    };
    const offer = journal.retainShared(bid, stored, reference);
    thread.finish("COMMITMENT_REFERENCE_UNAVAILABLE");
    await Promise.resolve();
    expect(thread.sent.at(-1)?.operation).toEqual({kind: "retain", bid, stored});
    thread.finish();
    expect(await offer).toBe("snapshot");
    const retained = journal.retainShared(bid, stored, reference);
    thread.finish();
    expect(await retained).toBe("reference");
    const ordinary = journal.retainShared(bid, stored, undefined);
    thread.finish();
    expect(await ordinary).toBe("snapshot");
    const uncertain = journal.retainShared(bid, stored, reference);
    thread.finish("COMMITMENT_JOURNAL_FAILED");
    await expect(uncertain).rejects.toThrow("COMMITMENT_JOURNAL_FAILED");
    expect(thread.sent.at(-1)?.operation.kind).toBe("retainReference");
    await journal.close();
  });

  it("exposes a reference only after acknowledgement and queues it without the payload", async () => {
    const {thread, journal, bid, stored} = setup();
    const reference = {
      slot: 1,
      blockHash: stored.blockHash,
      parentBlockRoot: toRootHex(stored.parentBlockRoot),
      parentBlockHash: toRootHex(stored.payload.executionPayload.parentHash),
      executionRequestsRoot: toRootHex(ssz.gloas.ExecutionRequests.hashTreeRoot(stored.payload.executionRequests)),
      commitments: [],
      files: [],
    };
    const retained = journal.retain(bid, stored);
    expect(journal.getReference(stored)).toBeUndefined();
    thread.emit("message", {id: thread.sent.at(-1)?.id, reference});
    await retained;
    expect(journal.getReference(stored)).toBe(reference);
    const offers = Array.from({length: 8}, () => journal.retainReference(bid, reference));
    await expect(journal.retainReference(bid, reference)).rejects.toThrow("COMMITMENT_WORKER_CAPACITY");
    expect(thread.sent.at(-1)?.operation).toEqual({kind: "retainReference", bid, reference});
    for (let i = 0; i < 8; i++) thread.finish();
    await Promise.all(offers);
    await journal.close();
  });

  it.each(["injected renameSync failure", "injected fsyncSync failure", "COMMITMENT_PAYLOAD_REFERENCE"])(
    "does not fall back to a snapshot after reference failure: %s",
    async (error) => {
      const {thread, journal, bid, stored} = setup();
      const reference = {
        slot: 1,
        blockHash: stored.blockHash,
        parentBlockRoot: toRootHex(stored.parentBlockRoot),
        parentBlockHash: toRootHex(stored.payload.executionPayload.parentHash),
        executionRequestsRoot: toRootHex(ssz.gloas.ExecutionRequests.hashTreeRoot(stored.payload.executionRequests)),
        commitments: [],
        files: [],
      };
      const offer = journal.retainShared(bid, stored, reference);
      thread.finish(error);
      await expect(offer).rejects.toMatchObject({message: error, uncertain: true});
      expect(thread.sent).toHaveLength(1);
      expect(thread.sent[0].operation.kind).toBe("retainReference");
      await journal.close();
    }
  );

  it("bounds queued offers, reserves reveal capacity, and waits for every acknowledgement on close", async () => {
    const {thread, journal, bid, stored} = setup();
    const offers = Array.from({length: 8}, () => journal.retain(bid, stored));
    await expect(journal.retain(bid, stored)).rejects.toThrow("COMMITMENT_WORKER_CAPACITY");
    const reveal = journal.retainReveal({
      slot: 1,
      blockHash: stored.blockHash,
      blockRoot: stored.blockHash,
      envelopeRoot: stored.blockHash,
    });
    expect(thread.sent).toHaveLength(1);
    thread.finish();
    expect(thread.sent.at(-1)?.operation.kind).toBe("reveal");
    thread.finish();
    await reveal;
    const close = journal.close();
    for (let i = 1; i < 8; i++) thread.finish();
    await Promise.all(offers);
    await close;
    await expect(journal.retain(bid, stored)).rejects.toThrow("COMMITMENT_WORKER_CLOSED");
  });

  it("rejects outstanding work and new offers after a worker failure", async () => {
    const {thread, journal, bid, stored} = setup();
    const pending = [journal.retain(bid, stored), journal.retain(bid, stored)];
    const outcomes = Promise.allSettled(pending);
    thread.emit("error", Error("worker failed"));
    expect(await outcomes).toMatchObject([
      {status: "rejected", reason: {uncertain: true}},
      {status: "rejected", reason: {uncertain: false}},
    ]);
    await expect(journal.retain(bid, stored)).rejects.toThrow("worker failed");
    await journal.close();
    expect(thread.sent).toHaveLength(1);
  });

  it("lets a slow write finish and then persists an already queued reveal", async () => {
    vi.useFakeTimers();
    try {
      const {thread, journal, bid, stored} = setup();
      const terminate = vi.spyOn(thread, "terminate");
      const offer = journal.retain(bid, stored);
      const outcome = expect(offer).rejects.toMatchObject({uncertain: true, message: "COMMITMENT_WORKER_TIMEOUT"});
      const reveal = journal.retainReveal({
        slot: 1,
        blockHash: stored.blockHash,
        blockRoot: stored.blockHash,
        envelopeRoot: stored.blockHash,
      });
      await vi.advanceTimersByTimeAsync(10_001);
      await outcome;
      expect(thread.sent).toHaveLength(1);
      expect(terminate).not.toHaveBeenCalled();
      thread.finish();
      expect(thread.sent.at(-1)?.operation.kind).toBe("reveal");
      thread.finish();
      await reveal;
      await journal.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces queued pruning without overtaking the active durable write", async () => {
    const {thread, journal, bid, stored} = setup();
    const offer = journal.retain(bid, stored);
    const first = journal.prune(2);
    const second = journal.prune(3);
    expect(first).toBe(second);
    expect(thread.sent).toHaveLength(1);
    thread.finish();
    expect(thread.sent.at(-1)?.operation).toEqual({kind: "prune", slot: 3});
    thread.finish();
    await Promise.all([offer, first, second]);
    await journal.close();
  });

  it("propagates uncertain disk failures without acknowledging the offer", async () => {
    const {thread, journal, bid, stored} = setup();
    const offer = journal.retain(bid, stored);
    thread.finish("disk failed");
    await expect(offer).rejects.toThrow("disk failed");
    await journal.close();
  });
});
