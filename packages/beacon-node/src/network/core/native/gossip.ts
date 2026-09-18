import {TopicValidatorResult} from "@libp2p/gossipsub";
import {PublishOpts} from "@libp2p/gossipsub/types";
import {NativeGossipHandle, NativeNetworkApplicationRuntime, NativeTopicKind} from "@chainsafe/lodestar-z/network";
import {BeaconConfig} from "@lodestar/config";
import {NetworkEvent, NetworkEventBus, NetworkEventData} from "../../events.js";
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
    for (const wake of this.consumers) wake?.();
  }
}

const claims = new WeakMap<NetworkEventBus, GossipRetirement>();

class GossipRetirement {
  readonly entries = new Map<string, {handle: NativeGossipHandle; bytes: number; kind?: NativeTopicKind}>();
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
    this.budget.release(entry.bytes, entry.kind);
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
  private processor: Pick<NativeGossipExecutor, "check" | "canExecute" | "execute"> | undefined;
  private detach: (() => void) | undefined;
  constructor(
    private readonly runtime: GossipRuntime,
    private readonly config: BeaconConfig,
    private readonly events: NetworkEventBus,
    private readonly opts: NetworkOptions,
    executionLimits?: readonly {items: number; bytes: number}[]
  ) {
    this.retirement = new GossipRetirement(
      runtime,
      events,
      GossipBudget.forEnvironment(
        opts.native?.hostGossipItems ?? 4096,
        opts.native?.hostGossipBytes ?? 64 * 1024 * 1024,
        executionLimits
      )
    );
  }
  attach(processor: Pick<NativeGossipExecutor, "check" | "canExecute" | "execute">, wake: () => void): void {
    if (this.closed || this.detach)
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "gossip executor attachment",
      });
    this.detach = this.retirement.budget.subscribe(wake);
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
    if (this.closed) return false;
    if (this.processor) {
      for (const check of this.runtime.drainGossipChecks())
        this.runtime.classifyGossip(check.handle, this.processor.check(check));
    }
    const order: (NativeTopicKind | undefined)[] = this.processor
      ? [
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
        ]
      : [undefined];
    let copied = 0;
    let more = false;
    for (const kind of order) {
      const room = this.retirement.budget.remaining(kind);
      if (room.items === 0 || room.bytes === 0 || copied === 64) continue;
      const batch = this.runtime.drainGossip({
        items: Math.min(64 - copied, room.items),
        bytes: Math.min(16 * 1024 * 1024, room.bytes),
        ordinary: this.processor?.canExecute() ?? true,
        kind,
      });
      const pending: PendingGossipsubMessage[] = [];
      for (const message of batch.messages) {
        const topic = parseGossipTopic(this.config, message.topic);
        const source = hostPeerId(message.peerId);
        const id = Buffer.from(message.id).toString("hex");
        const key = `${id}:${source}`;
        const bytes = message.data.buffer.byteLength;
        if (this.retirement.entries.has(key) || !this.retirement.budget.acquire(bytes, kind)) {
          this.runtime.reportGossip(message.handle, "ignore");
          continue;
        }
        this.retirement.entries.set(key, {handle: message.handle, bytes, kind});
        pending.push({
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
        });
      }
      copied += batch.messages.length;
      if (this.processor) {
        if (pending.length > 0) this.processor.execute(pending, batch.grouped);
      } else for (const message of pending) this.events.emit(NetworkEvent.pendingGossipsubMessage, message);
      more ||= batch.more && batch.messages.length > 0;
    }
    return more;
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
    this.detach?.();
    this.detach = undefined;
    this.retirement.close();
  }
}
