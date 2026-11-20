import {Worker} from "node:worker_threads";
import type {gloas} from "@lodestar/types";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import type {DurablePayload, JournalIdentity, RevealRecord} from "./commitmentJournal.js";
import {CommitmentJournalError} from "./commitmentJournalError.js";
import type {JournalExposure} from "./orderExposure.js";
import {parseOrderMetadata, sameOrderMetadata} from "./orderMetadata.js";
import type {BuiltPayload, StoredPayload} from "./payloadStore.js";

export type JournalOperation =
  | {kind: "retain"; bid: gloas.SignedExecutionPayloadBid; stored: StoredPayload}
  | {kind: "retainReference"; bid: gloas.SignedExecutionPayloadBid; reference: DurablePayload}
  | {kind: "reveal"; record: RevealRecord}
  | {kind: "prune"; slot: number}
  | {kind: "exposure"; orderId: string; admittedAtUnixMs: number};
export type JournalRequest = {id: number; operation: JournalOperation};
export type JournalReply = {
  id: number;
  error?: string;
  reference?: DurablePayload;
  exposure?: JournalExposure;
  coverageLost?: boolean;
};
export type JournalWorkerData = {directory: string; identity: JournalIdentity; sharedPayloadDirectory?: string};
export type JournalThread = {
  on(event: "message", listener: (reply: JournalReply) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  postMessage(request: JournalRequest): void;
  terminate(): Promise<number>;
};

const MAX_PENDING_BYTES = 64 * 1024 * 1024;
const MAX_PENDING_OFFERS = 8;
const MAX_PENDING_OPERATIONS = 16;
const OPERATION_TIMEOUT = 10_000;
const STARTUP_TIMEOUT = 30_000;

type Pending = JournalRequest & {
  bytes: number;
  result: ReturnType<typeof defer<JournalExposure | undefined>>;
  timedOut?: boolean;
};

/** One worker owns journal mutation. Only one request is cloned into it at a
 * time; queued payloads borrow the publisher's immutable retained snapshots.
 * Reveal records have reserved queue capacity and run before queued offers. */
export class AsyncCommitmentJournal {
  readonly ready = defer<void>();
  private readonly queue: Pending[] = [];
  private active?: Pending;
  private pendingBytes = 0;
  private pendingOffers = 0;
  private nextId = 1;
  private failure?: Error;
  private exposureUncertain = false;
  private readonly sharedRetentions = new Set<Promise<void>>();
  private closing = false;
  private initialized = false;
  private readonly references = new WeakMap<BuiltPayload["executionPayload"], DurablePayload>();
  private readonly closed = defer<void>();
  private timer: ReturnType<typeof setTimeout>;

  constructor(private readonly worker: JournalThread) {
    this.timer = setTimeout(() => this.fail(Error("COMMITMENT_WORKER_STARTUP_TIMEOUT")), STARTUP_TIMEOUT);
    worker.on("message", (reply: JournalReply) => this.onReply(reply));
    worker.on("error", (error: Error) => this.fail(error));
    worker.on("exit", () => {
      if (!this.closing || this.active || this.queue.length) this.fail(Error("COMMITMENT_WORKER_EXIT"));
      this.closed.resolve();
    });
  }

  static async start(data: JournalWorkerData): Promise<AsyncCommitmentJournal> {
    const journal = new AsyncCommitmentJournal(
      new Worker(new URL("./commitmentJournalWorker.js", import.meta.url), {workerData: data})
    );
    try {
      await journal.ready.promise;
      return journal;
    } catch (error) {
      await journal.close();
      throw error;
    }
  }

  retain(bid: gloas.SignedExecutionPayloadBid, stored: StoredPayload): Promise<void> {
    const bytes =
      ssz.gloas.ExecutionPayload.value_serializedSize(stored.payload.executionPayload) +
      ssz.gloas.ExecutionRequests.value_serializedSize(stored.payload.executionRequests) +
      ssz.gloas.BlobsBundle.value_serializedSize(stored.payload.blobsBundle) +
      4096;
    return this.enqueue({kind: "retain", bid, stored}, bytes) as Promise<void>;
  }

  canRetainAlternate(): boolean {
    return this.initialized && !this.failure && !this.closing && !this.active && this.queue.length === 0;
  }

  retainReveal(record: RevealRecord): Promise<void> {
    return this.enqueue({kind: "reveal", record}, 1024) as Promise<void>;
  }

  getReference(stored: StoredPayload): DurablePayload | undefined {
    const reference = this.references.get(stored.payload.executionPayload);
    if (!reference) return undefined;
    const orderMetadata = parseOrderMetadata(stored.payload.orderMetadata);
    return sameOrderMetadata(reference.orderMetadata, orderMetadata) ? reference : {...reference, orderMetadata};
  }

  retainReference(bid: gloas.SignedExecutionPayloadBid, reference: DurablePayload): Promise<void> {
    return this.enqueue(
      {kind: "retainReference", bid, reference},
      4096 + reference.files.length * 512
    ) as Promise<void>;
  }

  async retainShared(
    bid: gloas.SignedExecutionPayloadBid,
    stored: StoredPayload,
    reference: DurablePayload | undefined
  ): Promise<"reference" | "snapshot"> {
    const completed = defer<void>();
    this.sharedRetentions.add(completed.promise);
    try {
      if (reference) {
        try {
          await this.retainReference(bid, reference);
          return "reference";
        } catch (error) {
          if (!(error instanceof CommitmentJournalError) || error.message !== "COMMITMENT_REFERENCE_UNAVAILABLE")
            throw error;
        }
      }
      await this.retain(bid, stored);
      return "snapshot";
    } finally {
      this.sharedRetentions.delete(completed.promise);
      completed.resolve();
    }
  }

  prune(slot: number): Promise<void> {
    for (const pending of this.queue) {
      if (pending.operation.kind === "prune") {
        pending.operation.slot = Math.max(pending.operation.slot, slot);
        return pending.result.promise as Promise<void>;
      }
    }
    return this.enqueue({kind: "prune", slot}, 0) as Promise<void>;
  }

  isHealthy(): boolean {
    return this.initialized && !this.failure && !this.closing && !this.exposureUncertain;
  }

  async queryExposure(orderId: string, admittedAtUnixMs: number): Promise<JournalExposure> {
    // Reference fallback is enqueued after its reply; a queue-only barrier could overtake it.
    if (this.sharedRetentions.size > 0) await Promise.all(this.sharedRetentions);
    const result = await this.enqueue({kind: "exposure", orderId, admittedAtUnixMs}, 0);
    if (!result) throw Error("COMMITMENT_EXPOSURE_RESPONSE");
    return result;
  }

  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = true;
      if (this.active?.timedOut) this.fail(Error("COMMITMENT_WORKER_CLOSE_TIMEOUT"));
      else if (!this.active && !this.queue.length) await this.stop();
    }
    await this.closed.promise;
  }

  private enqueue(operation: JournalOperation, bytes: number): Promise<JournalExposure | undefined> {
    if (this.failure) return Promise.reject(new CommitmentJournalError(this.failure.message, false));
    if (this.closing) return Promise.reject(new CommitmentJournalError("COMMITMENT_WORKER_CLOSED", false));
    const exposurePending =
      Number(this.active?.operation.kind === "exposure") +
      this.queue.filter((pending) => pending.operation.kind === "exposure").length;
    if (operation.kind === "exposure" && exposurePending > 0)
      return Promise.reject(new CommitmentJournalError("COMMITMENT_EXPOSURE_BUSY", false));
    if (
      this.queue.length + Number(this.active !== undefined) - exposurePending >= MAX_PENDING_OPERATIONS ||
      ((operation.kind === "retain" || operation.kind === "retainReference") &&
        (this.pendingOffers >= MAX_PENDING_OFFERS || this.pendingBytes + bytes > MAX_PENDING_BYTES))
    )
      return Promise.reject(new CommitmentJournalError("COMMITMENT_WORKER_CAPACITY", false));
    const pending = {id: this.nextId++, operation, bytes, result: defer<JournalExposure | undefined>()};
    this.pendingBytes += bytes;
    if (operation.kind === "retain" || operation.kind === "retainReference") this.pendingOffers++;
    if (operation.kind === "reveal") this.queue.unshift(pending);
    else this.queue.push(pending);
    this.pump();
    return pending.result.promise;
  }

  private pump(): void {
    if (this.active || this.failure || !this.initialized) return;
    this.active = this.queue.shift();
    if (!this.active) {
      if (this.closing) void this.stop();
      return;
    }
    const {id, operation} = this.active;
    this.timer = setTimeout(() => {
      if (this.closing) this.fail(Error("COMMITMENT_WORKER_CLOSE_TIMEOUT"));
      else if (this.active) {
        // The caller stops waiting, but a slow disk can still complete. Keep
        // ownership until the late reply so pending reveals can then proceed.
        this.active.timedOut = true;
        this.exposureUncertain = true;
        this.active.result.reject(new CommitmentJournalError("COMMITMENT_WORKER_TIMEOUT", true));
      }
    }, OPERATION_TIMEOUT);
    try {
      // Clone, never transfer: old snapshots must remain available for reveal.
      this.worker.postMessage({id, operation} satisfies JournalRequest);
    } catch (error) {
      this.fail(error instanceof Error ? error : Error(String(error)));
    }
  }

  private onReply(reply: JournalReply): void {
    clearTimeout(this.timer);
    if (reply.coverageLost) this.exposureUncertain = true;
    if (reply.id === 0) {
      if (this.initialized) this.fail(Error("COMMITMENT_WORKER_RESPONSE"));
      else if (reply.error) this.fail(Error(reply.error));
      else {
        this.initialized = true;
        this.ready.resolve();
        this.pump();
      }
      return;
    }
    const pending = this.active;
    if (!pending || reply.id !== pending.id) {
      this.fail(Error("COMMITMENT_WORKER_RESPONSE"));
      return;
    }
    this.active = undefined;
    this.pendingBytes -= pending.bytes;
    if (pending.operation.kind === "retain" || pending.operation.kind === "retainReference") this.pendingOffers--;
    if (reply.error) {
      // This refusal is checked before any journal write/link, including after
      // recovery. It cannot make an earlier exposure uncertain.
      const admissionRefused = reply.error === "COMMITMENT_SLOT_ADMISSION_LIMIT";
      if (!admissionRefused && reply.error !== "COMMITMENT_REFERENCE_UNAVAILABLE") this.exposureUncertain = true;
      pending.result.reject(new CommitmentJournalError(reply.error, !admissionRefused));
    } else {
      if (pending.operation.kind === "retain" && reply.reference)
        this.references.set(pending.operation.stored.payload.executionPayload, reply.reference);
      pending.result.resolve(reply.exposure);
    }
    this.pump();
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    clearTimeout(this.timer);
    this.ready.reject(error);
    this.active?.result.reject(new CommitmentJournalError(error.message, true));
    this.active = undefined;
    for (const pending of this.queue.splice(0)) pending.result.reject(new CommitmentJournalError(error.message, false));
    this.pendingBytes = this.pendingOffers = 0;
    void this.stop();
  }

  private async stop(): Promise<void> {
    clearTimeout(this.timer);
    await this.worker.terminate();
    this.closed.resolve();
  }
}
