import {TopicValidatorResult} from "@libp2p/gossipsub";
import {NativeGossipClassification, NativeGossipDependencyCheck} from "@chainsafe/lodestar-z/network";
import {routes} from "@lodestar/api";
import {SlotRootHex} from "@lodestar/types";
import {BlockInputSource} from "../../../chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../../chain/emitter.js";
import {ClockEvent} from "../../../util/clock.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {GossipMessageInfo, GossipType} from "../../gossip/interface.js";
import {getGossipHandlers} from "../../processor/gossipHandlers.js";
import {getGossipValidatorBatchFn, getGossipValidatorFn} from "../../processor/gossipValidatorFn.js";
import {NetworkProcessorModules, NetworkProcessorOpts} from "../../processor/index.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";
import {NativeGossip} from "./gossip.js";

export class NativeGossipExecutor {
  private readonly validate;
  private readonly validateBatch;
  private stopped = false;
  private retry: NodeJS.Timeout | undefined;

  constructor(
    private readonly modules: NetworkProcessorModules,
    opts: NetworkProcessorOpts,
    private readonly gossip: Pick<NativeGossip, "attach" | "trackSearch" | "notifyBlock" | "dropQueued">,
    private readonly wake: () => void
  ) {
    const handlers = modules.gossipHandlers ?? getGossipHandlers(modules, opts);
    this.validate = getGossipValidatorFn(handlers, modules);
    this.validateBatch = getGossipValidatorBatchFn(handlers, modules);
    gossip.attach(this);
    modules.chain.emitter.on(routes.events.EventType.block, this.onBlock);
    modules.chain.clock.on(ClockEvent.slot, this.onSlot);
  }

  check(checks: NativeGossipDependencyCheck[]): NativeGossipClassification[] {
    const roots = new Map<string, boolean>();
    return checks.map((check) => {
      const root = `0x${Buffer.from(check.root).toString("hex")}`;
      let available = roots.get(root);
      if (available === undefined) {
        available = this.modules.chain.forkChoice.hasBlockHexUnsafe(root);
        roots.set(root, available);
      }
      if (!available)
        this.searchUnknownBlock({slot: Number(check.slot), root}, BlockInputSource.network_processor, check.peerId);
      return {handle: check.handle, available};
    });
  }

  canExecute(): boolean {
    const {chain} = this.modules;
    const ready = chain.blsThreadPoolCanAcceptWork() && chain.regenCanAcceptWork();
    if (!ready && !this.retry && !this.stopped) {
      this.retry = setTimeout(() => {
        this.retry = undefined;
        this.wake();
      }, 25);
      this.retry.unref();
    }
    return ready;
  }

  async execute(messages: PendingGossipsubMessage[], grouped: boolean): Promise<TopicValidatorResult[]> {
    if (this.stopped || messages.length === 0) return messages.map(() => TopicValidatorResult.Ignore);
    const start = Date.now() / 1000;
    const infos: GossipMessageInfo[] = messages.map((message) => {
      message.startProcessUnixSec = start;
      this.modules.metrics?.gossipValidationQueue.jobWaitTime.observe(
        {topic: message.topic.type},
        Math.max(0, start - message.seenTimestampSec)
      );
      return {...message, msgSlot: message.msgSlot ?? null};
    });
    this.modules.metrics?.networkProcessor.jobsSubmitted.observe(messages.length);
    if (infos[0].topic.type !== GossipType.beacon_attestation && (grouped || infos.length !== 1))
      throw new NativeNetworkError({
        code: NativeNetworkErrorCode.CONFIGURATION,
        resource: "native gossip validator job",
      });
    return infos[0].topic.type === GossipType.beacon_attestation
      ? this.validateBatch(infos)
      : [await this.validate(infos[0])];
  }

  observe(messages: PendingGossipsubMessage[], results: TopicValidatorResult[]): void {
    for (const [i, message] of messages.entries()) {
      if (message.startProcessUnixSec === null) continue;
      if (results[i] === TopicValidatorResult.Accept)
        this.modules.metrics?.gossipValidationQueue.jobTime.observe(
          {topic: message.topic.type},
          Math.max(0, Date.now() / 1000 - message.startProcessUnixSec) / messages.length
        );
    }
  }

  searchUnknownBlock({root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (this.stopped || this.modules.chain.seenBlock(root) || !this.gossip.trackSearch(root, peer)) return;
    this.modules.chain.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: root, peer, source});
  }

  searchUnknownEnvelope({slot, root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (this.stopped || this.modules.chain.seenPayloadEnvelope(root) || !this.gossip.trackSearch(root, peer)) return;
    this.modules.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex: root, slot, peer, source});
  }

  private readonly onBlock = ({block}: {block: string}): void => {
    this.gossip.notifyBlock(Buffer.from(block.slice(2), "hex"));
  };
  private readonly onSlot = (): void => {
    this.wake();
  };

  dropAllJobs(): void {
    this.gossip.dropQueued();
  }

  dumpGossipQueue(_type: GossipType): PendingGossipsubMessage[] {
    throw new NativeNetworkError({
      code: NativeNetworkErrorCode.UNAVAILABLE,
      resource: "native gossip payload dump; use native processor diagnostics",
    });
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.modules.chain.emitter.off(routes.events.EventType.block, this.onBlock);
    this.modules.chain.clock.off(ClockEvent.slot, this.onSlot);
    this.dropAllJobs();
  }
}
