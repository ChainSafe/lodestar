import {setTimeout as delay, setImmediate as yieldToIO} from "node:timers/promises";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {
  NativeGossipBatch,
  NativeGossipHandle,
  NativeGossipMessage,
  NativeNetworkApplicationRuntime,
} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {parseGossipTopic} from "../../gossip/topic.js";
import {NetworkOptions} from "../../options.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
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

export class NativeGossip {
  private closed = false;
  private processor: GossipExecutor | undefined;
  constructor(
    private readonly runtime: GossipRuntime,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly opts: NetworkOptions,
    private readonly onError: (error: unknown) => void,
    private readonly onFailure: (error: unknown) => void
  ) {}
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
  drain(): boolean {
    const processor = this.processor;
    if (this.closed || !processor) return false;
    const checks = this.runtime.drainGossipChecks();
    if (checks.length > 0) this.runtime.classifyGossip(processor.check(checks));
    const batch = this.runtime.drainGossip({items: 64, bytes: 16 * 1024 * 1024, ordinary: processor.canExecute()});
    if (batch.messages.length > 0) this.dispatch(batch, processor);
    return batch.more;
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
    for (const job of batch.jobs)
      void this.execute(messages.slice(job.start, job.start + job.length), job.grouped, processor, []).catch(
        this.onError
      );
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
  }
}
