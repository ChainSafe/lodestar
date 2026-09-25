import {setTimeout as delay, setImmediate as yieldToIO} from "node:timers/promises";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {
  NativeExchangeDemand,
  NativeGossipDependencyCheck,
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
import type {NativeClaim, NativeDrain, NativeJob} from "./drain.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";
import type {NativeGossipExecutor} from "./executor.js";

type GossipLedger = Pick<NativeDrain, "verdict" | "classify" | "block" | "dropQueued">;
type GossipExecutor = Pick<NativeGossipExecutor, "check" | "ready" | "execute" | "observe">;
/** Gossip bounds of one exchange. */
export type NativeGossipLimits = {checks: number; messages: number; bytes: number};
/** Intervals between an urgent job's exchange, dispatch, handler start and settlement, queued verdict and its exchange. */
type HostStage =
  | "exchange_to_dispatch"
  | "dispatch_to_start"
  | "start_to_complete"
  | "complete_to_queued"
  | "queued_to_sent";
/** An urgent job's kind and latest stage time. */
type JobTiming = {kind: NativeTopicKind; at: number};
type GossipJob = {
  handle: NativeGossipHandle;
  message?: PendingGossipsubMessage;
  result: TopicValidatorResult;
  completed: boolean;
  timing: JobTiming | null;
};
/** One validator job: a single message, or an attestation group validated together. */
type GossipExecution = {jobs: GossipJob[]; grouped: boolean};

export class NativeGossip {
  private closed = false;
  private processor: GossipExecutor | undefined;
  /** Claimed ordinary jobs a spent drain budget left for the next drain, at most one batch. */
  private queued: GossipExecution[] = [];
  /** When each processor slot's latest dependency check reached the host; bounded by the processor capacity. */
  private readonly checked = new Map<number, {generation: bigint; at: number}>();
  private readonly checkToDispatch: Histogram<{kind: NativeTopicKind}> | undefined;
  private readonly stages: Histogram<{kind: NativeTopicKind; interval: HostStage}> | undefined;
  constructor(
    private readonly runtime: Pick<NativeNetworkApplicationRuntime, "publishGossip">,
    private readonly ledger: GossipLedger,
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
    this.stages = register?.histogram<{kind: NativeTopicKind; interval: HostStage}>({
      name: "lodestar_native_gossip_host_stage_seconds",
      help: "Stages of each urgent gossip job on the host: its exchange's start to dispatch, dispatch to handler start, handler start to settlement, settlement to its verdict queued, and queued to the start of the exchange that applies it",
      labelNames: ["kind", "interval"],
      buckets: [0.00025, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5],
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
    if (!this.closed) this.ledger.block(root);
  }
  dropQueued(): void {
    if (!this.closed) this.ledger.dropQueued();
  }
  /**
   * The next exchange's gossip quotas and ordinary capacity. Ordinary work is claimed only while no claimed job
   * waits, the budget lasts and the executor can take it; urgent work whenever the executor is attached.
   */
  demand(
    {checks, messages, bytes}: NativeGossipLimits,
    deadline: number
  ): Pick<NativeExchangeDemand, "checks" | "messages" | "bytes" | "claimOrdinary"> & {ordinary: boolean} {
    const processor = this.processor;
    if (this.closed || !processor) return {bytes: 0, checks: 0, claimOrdinary: false, messages: 0, ordinary: false};
    return {
      bytes,
      checks,
      claimOrdinary: this.queued.length === 0 && performance.now() < deadline,
      messages,
      ordinary: processor.ready(),
    };
  }
  /**
   * Answers dependency checks and starts the claimed jobs, adopting each as it starts or holds it. Urgent jobs
   * (blocks, blob sidecars, data columns) all start now whatever the budget; ordinary jobs start until `deadline`, at
   * least one per turn unless the budget was spent before this delivery and no job was held. Checks the executor
   * cannot answer are classified unavailable. Returns whether claimed jobs wait for a later turn.
   */
  deliver(checks: readonly NativeGossipDependencyCheck[], jobs: NativeClaim<NativeJob>[], deadline: number): boolean {
    const processor = this.processor;
    if (this.closed || !processor) return false;
    if (checks.length > 0) {
      if (this.checkToDispatch) {
        const at = performance.now();
        for (const {handle} of checks) this.checked.set(handle.index, {generation: handle.generation, at});
      }
      let available: boolean[] = [];
      try {
        available = processor.check(checks);
      } catch (error) {
        this.onError(error);
      }
      for (const [i, {handle}] of checks.entries()) this.ledger.classify(handle, available[i] ?? false);
    }
    // Ordinary work claimed at the turn's start is new work, which a spent budget defers like the claim it replaced.
    const progress = this.queued.length > 0 || performance.now() < deadline;
    if (jobs.length > 0) this.dispatch(jobs, processor);
    return this.start(processor, deadline, progress);
  }
  /** Starts queued ordinary jobs until `deadline`, the first whatever the time when `progress`. Returns whether any remain. */
  private start(processor: GossipExecutor, deadline: number, progress: boolean): boolean {
    let started = 0;
    for (const {jobs, grouped} of this.queued) {
      if ((started > 0 || !progress) && performance.now() >= deadline) break;
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
    if (this.closed) return;
    const verdict =
      job.result === TopicValidatorResult.Accept
        ? "accept"
        : job.result === TopicValidatorResult.Reject
          ? "reject"
          : "ignore";
    const timing = job.timing;
    if (timing) {
      this.stamp(timing, "complete_to_queued", performance.now());
      this.ledger.verdict(job.handle, verdict, (at) => this.stamp(timing, "queued_to_sent", at));
    } else this.ledger.verdict(job.handle, verdict);
  }
  private stamp(timing: JobTiming, interval: HostStage, at: number): void {
    this.stages?.observe({kind: timing.kind, interval}, Math.max(0, at - timing.at) / 1000);
    timing.at = at;
  }
  private dispatch(claims: NativeClaim<NativeJob>[], processor: GossipExecutor): void {
    const dispatchedAt = performance.now();
    const prepared = claims.map(({item}) =>
      item.messages.map(
        ({handle}) => ({handle, result: TopicValidatorResult.Ignore, completed: false, timing: null}) as GossipJob
      )
    );
    const errors: unknown[] = [];
    try {
      for (const [i, jobs] of prepared.entries())
        for (const [j, job] of jobs.entries()) this.prepare(job, claims[i].item.messages[j]);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) {
      for (const claim of claims) claim.adopt();
      void this.execute(prepared.flat(), false, processor, errors).catch(this.onError);
      return;
    }
    const at = performance.now();
    for (const [i, {item: job}] of claims.entries()) {
      const jobs = prepared[i];
      for (const {handle} of jobs) {
        const check = this.checked.get(handle.index);
        if (check?.generation !== handle.generation) continue;
        this.checked.delete(handle.index);
        this.checkToDispatch?.observe({kind: job.kind}, (at - check.at) / 1000);
      }
      // Claims come in priority order, so urgent jobs start first and none waits for the budget.
      claims[i].adopt();
      if (job.urgent) {
        if (this.stages)
          for (const message of jobs) {
            message.timing = {kind: job.kind, at: job.exchangedAt};
            this.stamp(message.timing, "exchange_to_dispatch", dispatchedAt);
          }
        void this.execute(jobs, job.grouped, processor, []).catch(this.onError);
      } else this.queued.push({jobs, grouped: job.grouped});
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
    let started = false;
    try {
      for (const job of jobs)
        if (job.message) {
          pending.push(job.message);
          executing.push(job);
        }
      if (pending.length > 0 && errors.length === 0) {
        started = true;
        this.time(executing, "dispatch_to_start");
        results = await processor.execute(pending, grouped);
        for (const [i, job] of executing.entries()) job.result = results[i] ?? TopicValidatorResult.Ignore;
      }
    } catch (error) {
      errors.push(error);
    } finally {
      if (started) this.time(executing, "start_to_complete");
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
  /** Stamps the timed jobs in `jobs` at one moment. */
  private time(jobs: GossipJob[], interval: HostStage): void {
    if (!this.stages) return;
    const at = performance.now();
    for (const {timing} of jobs) if (timing) this.stamp(timing, interval, at);
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
