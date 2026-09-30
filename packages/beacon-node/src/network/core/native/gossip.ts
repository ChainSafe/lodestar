import {setTimeout as delay, setImmediate as yieldToIO} from "node:timers/promises";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {DependencyCheck, GossipJob, GossipMessage, NativeNetwork, Verdict} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {NetworkEvent, NetworkEventBus} from "../../events.js";
import {parseGossipTopic} from "../../gossip/topic.js";
import {NetworkOptions} from "../../options.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";
import type {NativeGossipExecutor} from "./executor.js";

type GossipExecutor = Pick<NativeGossipExecutor, "check" | "ready" | "execute" | "observe">;

const verdicts: Record<TopicValidatorResult, Verdict> = {
  [TopicValidatorResult.Accept]: "accept",
  [TopicValidatorResult.Reject]: "reject",
  [TopicValidatorResult.Ignore]: "ignore",
};

export class NativeGossip {
  private closed = false;
  private processor: GossipExecutor | undefined;
  constructor(
    private readonly network: Pick<NativeNetwork, "publish" | "blockImported" | "dropQueuedGossip">,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly opts: NetworkOptions,
    private readonly onError: (error: unknown) => void
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
    if (!this.closed) this.network.blockImported(root);
  }
  dropQueued(): void {
    if (!this.closed) this.network.dropQueuedGossip();
  }
  /** Whether ordinary gossip can execute now; urgent gossip always can. */
  ready(): boolean {
    return this.processor?.ready() ?? false;
  }
  checkDependencies(checks: readonly DependencyCheck[]): boolean[] {
    return this.attached().check(checks);
  }
  /** One verdict per message, in order. Observer and result event failures are reported, never retired as verdicts. */
  async validate(job: GossipJob): Promise<Verdict[]> {
    const processor = this.attached();
    const messages = job.messages.map((message) => this.prepare(message));
    const results = await processor.execute(messages, job.grouped, job.reported);
    const errors: unknown[] = [];
    try {
      processor.observe(messages);
    } catch (error) {
      errors.push(error);
    }
    for (const [i, message] of messages.entries()) {
      try {
        this.events.emit(NetworkEvent.gossipMessageValidationResult, {
          msgId: message.msgId,
          propagationSource: message.propagationSource,
          acceptance: results[i] ?? TopicValidatorResult.Ignore,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0)
      this.onError(errors.length === 1 ? errors[0] : new AggregateError(errors, "Native gossip observers failed"));
    return messages.map((_, i) => verdicts[results[i] ?? TopicValidatorResult.Ignore]);
  }
  private attached(): GossipExecutor {
    if (!this.processor)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "gossip executor"});
    return this.processor;
  }
  private prepare(message: GossipMessage): PendingGossipsubMessage {
    return {
      topic: parseGossipTopic(this.config, message.topic),
      msg: {type: "unsigned", topic: message.topic, data: message.data},
      msgId: Buffer.from(message.id).toString("hex"),
      propagationSource: message.peerId,
      clientAgent: "unknown",
      clientVersion: "unknown",
      indexed: message.attestationData ?? undefined,
      msgSlot: message.slot === null || message.slot === undefined ? undefined : Number(message.slot),
      seenTimestampSec: message.receivedAtUnixMs / 1000,
      startProcessUnixSec: null,
    };
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
        return (await this.network.publish(topic, data, options)).queued;
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
    this.closed = true;
  }
}
