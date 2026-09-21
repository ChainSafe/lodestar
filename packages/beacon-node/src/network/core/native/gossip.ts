import {setTimeout as delay, setImmediate as yieldToIO} from "node:timers/promises";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {
  NativeGossipBatch,
  NativeGossipHandle,
  NativeGossipMessage,
  NativeNetworkApplicationRuntime,
  NativeTopicKind,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {parseGossipTopic} from "../../gossip/topic.js";
import {NetworkOptions} from "../../options.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
import {hostPeerId, nativePeerId} from "./addresses.js";
import {kinds} from "./config.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";
import type {NativeGossipExecutor} from "./executor.js";

type GossipRuntime = Pick<
  NativeNetworkApplicationRuntime,
  | "drainGossip"
  | "reportGossip"
  | "publishGossip"
  | "drainGossipChecks"
  | "classifyGossip"
  | "notifyGossipBlock"
  | "dropQueuedGossip"
  | "trackGossipSearch"
>;

class GossipBudget {
  items = 0;
  bytes = 0;
  refused = 0n;
  readonly kindItems = new Array<number>(kinds.length).fill(0);
  readonly kindBytes = new Array<number>(kinds.length).fill(0);
  private readonly consumers = new Array<(() => void) | undefined>(64).fill(undefined);
  subscribe(wake: () => void): () => void {
    const index = this.consumers.findIndex((consumer) => consumer === undefined);
    if (index < 0)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "gossip budget consumers"});
    this.consumers[index] = wake;
    return () => {
      this.consumers[index] = undefined;
    };
  }
  remaining(kind?: NativeTopicKind): {items: number; bytes: number} {
    if (kind === undefined) return {items: this.maxItems - this.items, bytes: this.maxBytes - this.bytes};
    const index = kinds.indexOf(kind);
    const limit = this.limits?.[index];
    if (!limit) return {items: this.maxItems - this.items, bytes: this.maxBytes - this.bytes};
    return {
      items: Math.max(0, limit.items - this.kindItems[index]),
      bytes: Math.max(0, limit.bytes - this.kindBytes[index]),
    };
  }
  private static environment: GossipBudget | undefined;
  private constructor(
    private maxItems: number,
    private maxBytes: number,
    private limits?: readonly {items: number; bytes: number}[]
  ) {}
  static forEnvironment(
    maxItems: number,
    maxBytes: number,
    limits?: readonly {items: number; bytes: number}[]
  ): GossipBudget {
    nativeInteger(maxItems, "host gossip items", 16384, 1);
    nativeInteger(maxBytes, "host gossip bytes", 1024 * 1024 * 1024, 1);
    const current = GossipBudget.environment;
    if (
      current?.maxItems === maxItems &&
      current.maxBytes === maxBytes &&
      JSON.stringify(current.limits) === JSON.stringify(limits)
    )
      return current;
    if (current && current.items > 0)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "gossip policy changed with outstanding work",
      });
    if (current) {
      current.maxItems = maxItems;
      current.maxBytes = maxBytes;
      current.limits = limits;
      return current;
    }
    const budget = new GossipBudget(maxItems, maxBytes, limits);
    GossipBudget.environment = budget;
    return budget;
  }
  acquire(bytes: number, kind?: NativeTopicKind): boolean {
    const room = this.remaining(kind);
    if (room.items === 0 || bytes > room.bytes || this.items >= this.maxItems || this.bytes + bytes > this.maxBytes) {
      if (this.refused < 0xffff_ffff_ffff_ffffn) this.refused++;
      return false;
    }
    this.items++;
    this.bytes += bytes;
    if (kind !== undefined) {
      this.kindItems[kinds.indexOf(kind)]++;
      this.kindBytes[kinds.indexOf(kind)] += bytes;
    }
    return true;
  }
  release(bytes: number, kind?: NativeTopicKind): void {
    if (this.items < 1 || this.bytes < bytes)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "gossip credit invariant"});
    this.items--;
    this.bytes -= bytes;
    if (kind !== undefined) {
      this.kindItems[kinds.indexOf(kind)]--;
      this.kindBytes[kinds.indexOf(kind)] -= bytes;
    }
  }
  wake(): void {
    const errors: unknown[] = [];
    for (const wake of this.consumers) {
      try {
        wake?.();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "Gossip budget wake failed");
  }
}

type GossipExecutor = Pick<NativeGossipExecutor, "check" | "canExecute" | "execute" | "observe">;
type GossipJob = {
  handle: NativeGossipHandle;
  message?: PendingGossipsubMessage;
  credit?: {key: string; bytes: number};
  result: TopicValidatorResult;
  completed: boolean;
};

export class NativeGossip {
  private readonly budget: GossipBudget;
  private readonly entries = new Set<string>();
  private closed = false;
  private processor: GossipExecutor | undefined;
  private detach: (() => void) | undefined;
  constructor(
    private readonly runtime: GossipRuntime,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly opts: NetworkOptions,
    private readonly onError: (error: unknown) => void,
    executionLimits?: readonly {items: number; bytes: number}[]
  ) {
    this.budget = GossipBudget.forEnvironment(
      opts.native?.hostGossipItems ?? 4096,
      opts.native?.hostGossipBytes ?? 64 * 1024 * 1024,
      executionLimits
    );
  }
  attach(processor: GossipExecutor, wake: () => void): void {
    if (this.closed || this.detach)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "gossip executor attachment",
      });
    this.detach = this.budget.subscribe(wake);
    this.processor = processor;
  }
  notifyBlock(root: Uint8Array): void {
    if (!this.closed) this.runtime.notifyGossipBlock(root);
  }
  dropQueued(): void {
    if (!this.closed) this.runtime.dropQueuedGossip();
  }
  trackSearch(root: string, peer?: string): boolean {
    return (
      !this.closed &&
      this.runtime.trackGossipSearch(Buffer.from(root.slice(2), "hex"), peer === undefined ? null : nativePeerId(peer))
    );
  }
  drain(): boolean {
    const processor = this.processor;
    if (this.closed || !processor) return false;
    for (const check of this.runtime.drainGossipChecks())
      this.runtime.classifyGossip(check.handle, processor.check(check));
    const order: NativeTopicKind[] = [
      "beacon_block",
      "blob_sidecar",
      "data_column_sidecar",
      "beacon_aggregate_and_proof",
      "voluntary_exit",
      "bls_to_execution_change",
      "beacon_attestation",
      "proposer_slashing",
      "attester_slashing",
      "sync_committee_contribution_and_proof",
      "sync_committee",
      "light_client_finality_update",
      "light_client_optimistic_update",
    ];
    let copied = 0;
    let more = false;
    for (const kind of order) {
      const room = this.budget.remaining(kind);
      if (room.items === 0 || room.bytes === 0 || copied === 64) continue;
      const batch = this.runtime.drainGossip({
        items: Math.min(64 - copied, room.items),
        bytes: Math.min(16 * 1024 * 1024, room.bytes),
        ordinary: processor.canExecute(),
        kind,
      });
      copied += batch.messages.length;
      if (batch.messages.length > 0) void this.dispatch(batch, kind, processor).catch(this.onError);
      more ||= batch.more && batch.messages.length > 0;
    }
    return more;
  }
  private prepare(job: GossipJob, message: NativeGossipMessage, kind: NativeTopicKind): void {
    const topic = parseGossipTopic(this.config, message.topic);
    const source = hostPeerId(message.peerId);
    const id = Buffer.from(message.id).toString("hex");
    const key = `${id}:${source}`;
    const pending: PendingGossipsubMessage = {
      topic,
      msg: {type: "unsigned", topic: message.topic, data: message.data},
      msgId: id,
      propagationSource: source,
      clientAgent: "unknown",
      clientVersion: "unknown",
      indexed: message.attestationData ?? undefined,
      msgSlot: message.slot === null || message.slot === undefined ? undefined : Number(message.slot),
      seenTimestampSec: message.receivedAtUnixMs / 1000,
      startProcessUnixSec: null,
    };
    const bytes = message.data.buffer.byteLength;
    if (this.entries.has(key) || !this.budget.acquire(bytes, kind)) return;
    job.credit = {key, bytes};
    this.entries.add(key);
    job.message = pending;
  }
  private complete(job: GossipJob, kind: NativeTopicKind): void {
    if (job.completed) return;
    job.completed = true;
    try {
      if (!this.closed)
        this.runtime.reportGossip(
          job.handle,
          job.result === TopicValidatorResult.Accept
            ? "accept"
            : job.result === TopicValidatorResult.Reject
              ? "reject"
              : "ignore"
        );
    } finally {
      if (job.credit !== undefined) {
        this.entries.delete(job.credit.key);
        this.budget.release(job.credit.bytes, kind);
      }
    }
  }
  private dispatch(batch: NativeGossipBatch, kind: NativeTopicKind, processor: GossipExecutor): Promise<void> {
    const jobs: GossipJob[] = batch.messages.map(({handle}) => ({
      handle,
      result: TopicValidatorResult.Ignore,
      completed: false,
    }));
    const errors: unknown[] = [];
    try {
      for (const [i, job] of jobs.entries()) {
        this.prepare(job, batch.messages[i], kind);
        if (!job.message) this.complete(job, kind);
      }
    } catch (error) {
      errors.push(error);
    }
    return this.execute(jobs, batch.grouped, kind, processor, errors);
  }
  private async execute(
    jobs: GossipJob[],
    grouped: boolean,
    kind: NativeTopicKind,
    processor: GossipExecutor,
    errors: unknown[]
  ): Promise<void> {
    const pending: PendingGossipsubMessage[] = [];
    const executing: GossipJob[] = [];
    let results: TopicValidatorResult[] = [];
    try {
      for (const job of jobs)
        if (job.message) {
          pending.push(job.message);
          executing.push(job);
        }
      if (pending.length > 0 && errors.length === 0) {
        results = await processor.execute(pending, grouped);
        for (const [i, job] of executing.entries()) job.result = results[i] ?? TopicValidatorResult.Ignore;
      }
    } catch (error) {
      errors.push(error);
    } finally {
      for (const job of jobs) {
        try {
          this.complete(job, kind);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    // Observers may throw or dispatch more work. Every handle and credit must be retired first.
    try {
      processor.observe(pending, results);
    } catch (error) {
      errors.push(error);
    }
    for (const [i, message] of pending.entries()) {
      try {
        this.events.emit(NetworkEvent.gossipMessageValidationResult, {
          msgId: message.msgId,
          propagationSource: message.propagationSource,
          acceptance: executing[i].result,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      this.budget.wake();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Native gossip batch failed");
  }
  snapshot() {
    const {budget, entries} = this;
    return {items: budget.items, bytes: budget.bytes, refused: budget.refused, activeItems: entries.size};
  }
  async publish(topic: string, data: Uint8Array, opts?: PublishOpts): Promise<number> {
    if (this.closed)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "gossip publication"});
    if (opts?.batchPublish === false)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.UNAVAILABLE,
        resource: "unbatched gossip publication",
      });
    const options = {
      allowZeroPeers: opts?.allowPublishToZeroTopicPeers ?? this.opts.allowPublishToZeroPeers ?? false,
      ignoreDuplicate: opts?.ignoreDuplicatePublishError ?? false,
      flood: opts?.floodPublish ?? !this.opts.disableFloodPublish,
    };
    const deadline = performance.now() + this.config.SLOT_DURATION_MS;
    for (let retry = 0; ; retry++) {
      if (this.closed)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "gossip publication"});
      try {
        return (await this.runtime.publishGossip(topic, data, options)).queued;
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "NetworkGossipPublishFailed" &&
          "reason" in error
        ) {
          if (error.reason === "duplicate") throw new Error("PublishError.Duplicate", {cause: error});
          // Admission refusal has no publication side effects. Keep the validated bytes here, so an API
          // retry cannot lose the message to the validator's already-seen check.
          if (
            error.reason === "admission_full" &&
            retry < this.config.SLOT_DURATION_MS &&
            performance.now() < deadline
          ) {
            if (retry === 0) await yieldToIO();
            else await delay(1);
            continue;
          }
        }
        throw error;
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.detach?.();
    this.detach = undefined;
  }
}
