import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {NativeGossipHandle, NativeNetworkApplicationRuntime} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../../events.js";
import {parseGossipTopic} from "../../gossip/topic.js";
import {NetworkOptions} from "../../options.js";
import {hostPeerId} from "./addresses.js";
import {NativeNetworkError, NativeNetworkErrorCode, nativeInteger} from "./errors.js";

type GossipRuntime = Pick<NativeNetworkApplicationRuntime, "drainGossip" | "reportGossip" | "publishGossip">;

class GossipBudget {
  items = 0;
  bytes = 0;
  refused = 0n;
  private static environment: GossipBudget | undefined;
  private constructor(
    private maxItems: number,
    private maxBytes: number
  ) {}
  static forEnvironment(maxItems: number, maxBytes: number): GossipBudget {
    nativeInteger(maxItems, "host gossip items", 16384, 1);
    nativeInteger(maxBytes, "host gossip bytes", 1024 * 1024 * 1024, 1);
    const current = GossipBudget.environment;
    if (current?.maxItems === maxItems && current.maxBytes === maxBytes) return current;
    if (current && current.items > 0)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "gossip policy changed with outstanding work",
      });
    if (current) {
      current.maxItems = maxItems;
      current.maxBytes = maxBytes;
      return current;
    }
    const budget = new GossipBudget(maxItems, maxBytes);
    GossipBudget.environment = budget;
    return budget;
  }
  acquire(bytes: number): boolean {
    if (this.items >= this.maxItems || this.bytes + bytes > this.maxBytes) {
      if (this.refused < 0xffff_ffff_ffff_ffffn) this.refused++;
      return false;
    }
    this.items++;
    this.bytes += bytes;
    return true;
  }
  release(bytes: number): void {
    if (this.items < 1 || this.bytes < bytes)
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CONFIGURATION, resource: "gossip credit invariant"});
    this.items--;
    this.bytes -= bytes;
  }
}

const claims = new WeakMap<NetworkEventBus, GossipRetirement>();

class GossipRetirement {
  readonly entries = new Map<string, {handle: NativeGossipHandle; bytes: number}>();
  private runtime: GossipRuntime | undefined;
  constructor(
    runtime: GossipRuntime,
    private readonly events: NetworkEventBus,
    readonly budget: GossipBudget
  ) {
    if (claims.has(events))
      throw new NativeNetworkError({code: NativeNetworkErrorCode.CAPACITY, resource: "gossip event bus still owned"});
    this.runtime = runtime;
    claims.set(events, this);
    events.on(NetworkEvent.gossipMessageValidationResult, this.retire);
  }
  private readonly retire = ({
    msgId,
    propagationSource,
    acceptance,
  }: NetworkEventData[NetworkEvent.gossipMessageValidationResult]): void => {
    if (msgId.length !== 40 || propagationSource.length > 128) return;
    const key = `${msgId}:${propagationSource}`;
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.budget.release(entry.bytes);
    try {
      this.runtime?.reportGossip(
        entry.handle,
        acceptance === TopicValidatorResult.Accept
          ? "accept"
          : acceptance === TopicValidatorResult.Reject
            ? "reject"
            : "ignore"
      );
    } finally {
      this.releaseBus();
    }
  };
  close(): void {
    this.runtime = undefined;
    this.releaseBus();
  }
  private releaseBus(): void {
    if (!this.runtime && this.entries.size === 0) {
      this.events.off(NetworkEvent.gossipMessageValidationResult, this.retire);
      claims.delete(this.events);
    }
  }
}

export class NativeGossip {
  private readonly retirement: GossipRetirement;
  private closed = false;
  constructor(
    private readonly runtime: GossipRuntime,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly opts: NetworkOptions
  ) {
    this.retirement = new GossipRetirement(
      runtime,
      events,
      GossipBudget.forEnvironment(
        opts.native?.hostGossipItems ?? 4096,
        opts.native?.hostGossipBytes ?? 64 * 1024 * 1024
      )
    );
  }
  drain(): boolean {
    if (this.closed) return false;
    const batch = this.runtime.drainGossip();
    for (const message of batch.messages) {
      const topic = parseGossipTopic(this.config, message.topic);
      const source = hostPeerId(message.peerId);
      const id = Buffer.from(message.id).toString("hex");
      const key = `${id}:${source}`;
      const bytes = message.data.buffer.byteLength;
      if (this.retirement.entries.has(key) || !this.retirement.budget.acquire(bytes)) {
        this.runtime.reportGossip(message.handle, "ignore");
        continue;
      }
      this.retirement.entries.set(key, {handle: message.handle, bytes});
      this.events.emit(NetworkEvent.pendingGossipsubMessage, {
        topic,
        msg: {type: "unsigned", topic: message.topic, data: message.data},
        msgId: id,
        propagationSource: source,
        clientAgent: "unknown",
        clientVersion: "unknown",
        seenTimestampSec: message.receivedAtUnixMs / 1000,
        startProcessUnixSec: null,
      });
    }
    return batch.more;
  }
  snapshot() {
    const {budget, entries} = this.retirement;
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
    try {
      const result = await this.runtime.publishGossip(topic, data, {
        allowZeroPeers: opts?.allowPublishToZeroTopicPeers ?? this.opts.allowPublishToZeroPeers ?? false,
        ignoreDuplicate: opts?.ignoreDuplicatePublishError ?? false,
        flood: opts?.floodPublish ?? !this.opts.disableFloodPublish,
      });
      return result.queued;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "NetworkGossipPublishFailed" &&
        "reason" in error &&
        error.reason === "duplicate"
      )
        throw new Error("PublishError.Duplicate", {cause: error});
      throw error;
    }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.retirement.close();
  }
}
