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
import {Histogram} from "@lodestar/utils";
import {RegistryMetricCreator} from "../../../metrics/utils/registryMetricCreator.js";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {parseGossipTopic} from "../../gossip/topic.js";
import {NetworkOptions} from "../../options.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
import {NativeGossipDrainLimits, nativeLanes} from "./drain.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";
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

type GossipExecutor = Pick<NativeGossipExecutor, "check" | "canExecute" | "execute" | "observe">;
type GossipJob = {
  handle: NativeGossipHandle;
  message?: PendingGossipsubMessage;
  result: TopicValidatorResult;
  completed: boolean;
};
/** One validator job: a single message, or an attestation group validated together. */
type GossipExecution = {jobs: GossipJob[]; grouped: boolean};

export class NativeGossip {
  private closed = false;
  private processor: GossipExecutor | undefined;
  /** Claimed ordinary jobs a spent drain budget left for the next drain, at most one batch. */
  private queued: GossipExecution[] = [];
  /** Whether native claims ordinary work, as the last drainGossip asked. */
  private ordinary = true;
  /** When each processor slot's latest dependency check reached the host; bounded by the processor capacity. */
  private readonly checked = new Map<number, {generation: bigint; at: number}>();
  private readonly checkToDispatch: Histogram<{kind: NativeTopicKind}> | undefined;
  constructor(
    private readonly runtime: GossipRuntime,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly opts: NetworkOptions,
    private readonly onError: (error: unknown) => void,
    private readonly onFailure: (error: unknown) => void,
    register: RegistryMetricCreator | null = null
  ) {
    this.checkToDispatch = register?.histogram<{kind: NativeTopicKind}>({
      name: "lodestar_native_gossip_check_to_dispatch_seconds",
      help: "Delay from a gossip message's latest dependency check reaching the host to the dispatch of its job",
      labelNames: ["kind"],
      buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
    });
  }
  attach(processor: GossipExecutor): void {
    if (this.closed || this.processor)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "gossip executor attachment",
      });
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
      this.runtime.trackGossipSearch(Buffer.from(root.slice(2), "hex"), peer === undefined ? null : peer)
    );
  }
  /**
   * Answers dependency checks, claims at most `items`/`bytes` and starts the claimed jobs. Urgent jobs (blocks, blob
   * sidecars, data columns) all start in this drain whatever the budget. Ordinary jobs start until `deadline`, at
   * least one per drain, and native claims ordinary work only while none is queued, the budget lasts and the executor
   * can take it. Native lanes without work are not called. Returns whether work remains.
   */
  drain({items, bytes, deadline, lanes}: NativeGossipDrainLimits): boolean {
    const processor = this.processor;
    if (this.closed || !processor) return false;
    let urgentWork = (lanes & nativeLanes.gossipUrgent) !== 0;
    let ordinaryWork = (lanes & nativeLanes.gossipOrdinary) !== 0;
    if (lanes & nativeLanes.gossipChecks) {
      const checks = this.runtime.drainGossipChecks();
      if (this.checkToDispatch) {
        const at = performance.now();
        for (const {handle} of checks) this.checked.set(handle.index, {generation: handle.generation, at});
      }
      if (checks.length > 0) {
        this.runtime.classifyGossip(processor.check(checks));
        // Available dependencies can make work of any kind claimable.
        urgentWork = true;
        ordinaryWork = true;
      }
    }
    let more = false;
    if (urgentWork || ordinaryWork || !this.ordinary) {
      const ready = processor.canExecute();
      const ordinary = ready && this.queued.length === 0 && performance.now() < deadline;
      // A claim also sets native's ordinary gate. It stays closed only while the executor cannot take ordinary work,
      // whose retry drains again; a gate closed for queued jobs or the budget reopens in a later drain.
      if (urgentWork || (ordinary && (ordinaryWork || !this.ordinary)) || (!ready && this.ordinary && ordinaryWork)) {
        // Native sets the gate before copying, so a failed copy leaves it as asked.
        this.ordinary = ordinary;
        const batch = this.runtime.drainGossip({items, bytes, ordinary});
        if (batch.messages.length > 0) this.dispatch(batch, processor);
        more = batch.more;
      }
      // Ordinary work held back for queued jobs or the budget, or a gate left closed, needs a later drain.
      more ||= ready && !ordinary && (ordinaryWork || !this.ordinary);
    }
    return this.start(processor, deadline) || more;
  }
  /** Starts queued ordinary jobs, at least one, until `deadline`. Returns whether any remain. */
  private start(processor: GossipExecutor, deadline: number): boolean {
    let started = 0;
    for (const {jobs, grouped} of this.queued) {
      if (started > 0 && performance.now() >= deadline) break;
      started++;
      void this.execute(jobs, grouped, processor, []).catch(this.onError);
    }
    this.queued = this.queued.slice(started);
    return this.queued.length > 0;
  }
  private prepare(job: GossipJob, message: NativeGossipMessage): void {
    const topic = parseGossipTopic(this.config, message.topic);
    const source = message.peerId;
    const id = Buffer.from(message.id).toString("hex");
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
    job.message = pending;
  }
  private complete(job: GossipJob): void {
    if (job.completed) return;
    job.completed = true;
    if (!this.closed)
      this.runtime.reportGossip(
        job.handle,
        job.result === TopicValidatorResult.Accept
          ? "accept"
          : job.result === TopicValidatorResult.Reject
            ? "reject"
            : "ignore"
      );
  }
  private dispatch(batch: NativeGossipBatch, processor: GossipExecutor): void {
    const messages: GossipJob[] = batch.messages.map(({handle}) => ({
      handle,
      result: TopicValidatorResult.Ignore,
      completed: false,
    }));
    const errors: unknown[] = [];
    try {
      for (const [i, job] of messages.entries()) this.prepare(job, batch.messages[i]);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      void this.execute(messages, false, processor, errors).catch(this.onError);
      return;
    }
    const at = performance.now();
    for (const job of batch.jobs) {
      const jobs = messages.slice(job.start, job.start + job.length);
      for (const {handle} of jobs) {
        const check = this.checked.get(handle.index);
        if (check?.generation !== handle.generation) continue;
        this.checked.delete(handle.index);
        this.checkToDispatch?.observe({kind: job.kind}, (at - check.at) / 1000);
      }
      // Claims come in priority order, so urgent jobs start first and none waits for the budget.
      if (job.urgent) void this.execute(jobs, job.grouped, processor, []).catch(this.onError);
      else this.queued.push({jobs, grouped: job.grouped});
    }
  }
  private async execute(
    jobs: GossipJob[],
    grouped: boolean,
    processor: GossipExecutor,
    errors: unknown[]
  ): Promise<void> {
    const pending: PendingGossipsubMessage[] = [];
    const executing: GossipJob[] = [];
    let results: TopicValidatorResult[] = [];
    const completionErrors: unknown[] = [];
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
          this.complete(job);
        } catch (error) {
          completionErrors.push(error);
        }
      }
    }
    if (completionErrors.length > 0)
      this.onFailure(
        completionErrors.length === 1
          ? completionErrors[0]
          : new AggregateError(completionErrors, "Native gossip retirement failed")
      );
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
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Native gossip job failed");
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
    this.queued = [];
  }
}
