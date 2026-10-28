import {setMaxListeners} from "node:events";
import {setImmediate as yieldToIO} from "node:timers/promises";
import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {DependencyCheck, GossipJob, GossipMessage, NativeNetwork, Verdict} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {parseGossipTopic} from "../../gossip/topic.js";
import {NetworkOptions} from "../../options.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";
import type {NativeGossipExecutor} from "./executor.js";
import type {NativePeerReports} from "./reports.js";

type GossipExecutor = Pick<NativeGossipExecutor, "check" | "ready" | "execute" | "observe" | "subscribeCapacity">;

const verdicts: Record<TopicValidatorResult, Verdict> = {
  [TopicValidatorResult.Accept]: "accept",
  [TopicValidatorResult.Reject]: "reject",
  [TopicValidatorResult.Ignore]: "ignore",
};

export class NativeGossip {
  private closed = false;
  private readonly publicationAbort = new AbortController();
  private processor: GossipExecutor | undefined;
  private capacityWake: (() => void) | undefined;
  private unsubscribeCapacity: (() => void) | undefined;
  constructor(
    private readonly network: Pick<
      NativeNetwork,
      "publish" | "waitForPublicationCapacity" | "limits" | "blockImported" | "dropQueuedGossip"
    >,
    private readonly config: BeaconConfig,
    private readonly opts: NetworkOptions,
    private readonly onError: (error: unknown) => void,
    private readonly reports: Pick<NativePeerReports, "forGossip">
  ) {
    setMaxListeners(0, this.publicationAbort.signal);
  }
  attach(processor: GossipExecutor): void {
    if (this.closed || this.processor)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "gossip executor attachment",
      });
    this.processor = processor;
    if (this.capacityWake) {
      this.unsubscribeCapacity = processor.subscribeCapacity(this.capacityWake);
      this.capacityWake();
    }
  }
  subscribeCapacity(wake: () => void): () => void {
    if (this.capacityWake)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "capacity subscription"});
    this.capacityWake = wake;
    this.unsubscribeCapacity = this.processor?.subscribeCapacity(wake);
    return () => {
      if (this.capacityWake !== wake) return;
      this.unsubscribeCapacity?.();
      this.unsubscribeCapacity = undefined;
      this.capacityWake = undefined;
    };
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
  /** One verdict per message, in order. Observer failures do not change the verdicts. */
  async validate(job: GossipJob): Promise<Verdict[]> {
    const processor = this.attached();
    const messages = job.messages.map((message) => this.prepare(message));
    const results = await processor.execute(messages, job.grouped);
    try {
      processor.observe(messages, results);
    } catch (error) {
      this.onError(error);
    }
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
      reportPeer: this.reports.forGossip(message),
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
    const deadline = performance.now() + this.network.limits.publicationMaxWaitMs;
    for (;;) {
      if (this.closed)
        throw new NativeNetworkError({code: NativeNetworkErrorCode.CLOSED, resource: "gossip publication"});
      const maxQueueMs = Math.floor(deadline - performance.now());
      if (maxQueueMs < 1) throw publicationExpired();
      try {
        return (await this.network.publish(topic, data, {...options, maxQueueMs})).queued;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "NetworkGossipPublishFailed") throw error;
        if (!("reason" in error)) throw error;
        if (error.reason === "duplicate") throw new Error("PublishError.Duplicate", {cause: error});
        if (error.reason !== "admission_full" || !("capacityToken" in error) || typeof error.capacityToken !== "string")
          throw error;
        await this.waitForPublication(error.capacityToken, deadline);
      }
    }
  }

  private async waitForPublication(token: string, deadline: number): Promise<void> {
    const timeoutMs = Math.floor(deadline - performance.now());
    if (timeoutMs < 1) throw publicationExpired();
    try {
      await this.network.waitForPublicationCapacity(token, {signal: this.publicationAbort.signal, timeoutMs});
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "NetworkPublicationCapacityTimeout")
        throw publicationExpired();
      throw error;
    }
    // A changed revision may already be stale. Let settlements and other host work run before retrying.
    await yieldToIO();
  }

  close(): void {
    this.closed = true;
    this.publicationAbort.abort();
  }
}

function publicationExpired(): Error {
  return Object.assign(new Error("Native gossip publication expired"), {
    code: "NetworkGossipPublishFailed",
    reason: "expired",
  });
}
