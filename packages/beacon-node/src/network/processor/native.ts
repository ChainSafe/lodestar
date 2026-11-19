import {TopicValidatorResult} from "@libp2p/gossipsub";
import {routes} from "@lodestar/api";
import {
  DependencyCheck,
  GossipDelivery,
  GossipDependencyDecision,
  gossipDependencyDecision,
  gossipQueues,
} from "@lodestar/native/gossip-queues";
import {SlotRootHex} from "@lodestar/types";
import {BlockInputSource} from "../../chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../chain/emitter.js";
import {GossipErrorCode} from "../../chain/errors/gossipValidation.js";
import {ClockEvent} from "../../util/clock.js";
import {PeerIdStr} from "../../util/peerId.js";
import {NetworkEvent} from "../events.js";
import {GossipType} from "../gossip/interface.js";
import {GossipTopicCache} from "../gossip/topic.js";
import {createExtractBlockSlotRootFns} from "./extractSlotRootFns.js";
import {getGossipHandlers} from "./gossipHandlers.js";
import {GossipRootSearch} from "./gossipRootSearch.js";
import {getGossipValidatorBatchFn, getGossipValidatorFn, rejectPeerAction} from "./gossipValidatorFn.js";
import {
  CannotAcceptWorkReason,
  FATAL_PEER_EXPIRY_SLOTS,
  MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE,
  NetworkProcessorModules,
  NetworkProcessorOpts,
  ReprocessRejectReason,
} from "./index.js";
import {GossipReceipt} from "./nativeIngress.js";
import {PendingGossipsubMessage} from "./types.js";

const DRAIN_RETRY_MS = 250;

export class NativeGossipProcessor {
  private readonly topics: GossipTopicCache;
  private readonly slotted = createExtractBlockSlotRootFns();
  private readonly fatalPeers = new Map<PeerIdStr, number>();
  private readonly validate;
  private readonly validateBatch;
  private stopped = false;
  private retrying = false;
  private immediate?: NodeJS.Immediate;
  private timer?: NodeJS.Timeout;
  private readonly searches: GossipRootSearch;

  constructor(
    private readonly id: number,
    private readonly modules: NetworkProcessorModules,
    opts: NetworkProcessorOpts
  ) {
    this.searches = new GossipRootSearch(modules.chain);
    this.topics = new GossipTopicCache(modules.config);
    const handlers = modules.gossipHandlers ?? getGossipHandlers(modules, opts);
    const dropPeer = (peer: PeerIdStr): void => {
      if (this.stopped) return;
      if (!this.fatalPeers.has(peer)) gossipQueues.setPeerFatal(id, peer, true);
      this.fatalPeers.set(peer, modules.chain.clock.currentSlot);
    };
    this.validate = getGossipValidatorFn(handlers, modules, dropPeer);
    this.validateBatch = getGossipValidatorBatchFn(handlers, modules, dropPeer);
    modules.chain.clock.on(ClockEvent.slot, this.onSlot);
    modules.events.on(NetworkEvent.gossipQueueReady, this.wake);
    modules.chain.emitter.on(ChainEvent.validationCapacity, this.wake);
    modules.chain.emitter.on(routes.events.EventType.block, this.onBlock);
    modules.chain.emitter.on(routes.events.EventType.executionPayload, this.onPayload);
    const metrics = modules.metrics;
    metrics?.gossipValidationQueue.length.addCollect(() => {
      if (this.stopped) return;
      const stats = gossipQueues.stats(id);
      const queue = metrics.gossipValidationQueue;
      let awaitingBlock = 0;
      let awaitingPayload = 0;
      for (const topic of Object.values(GossipType)) {
        const {queued, executing, keys, drops, block, payload} = stats.topics[topic];
        queue.length.set({topic}, queued);
        queue.concurrency.set({topic}, executing);
        queue.keySize.set({topic}, keys);
        queue.droppedJobs.set({topic}, drops.capacity);
        for (const [reason, count] of Object.entries(drops)) queue.nativeDrops.set({topic, reason}, count);
        awaitingBlock += block.current;
        awaitingPayload += payload.current;
        for (const [wait, gauges] of [
          [block, metrics.awaitingBlockGossipMessages],
          [payload, metrics.awaitingPayloadGossipMessages],
        ] as const) {
          gauges.queue.set({topic}, wait.entered);
          gauges.resolve.set({topic}, wait.resolved);
          gauges.reject.set({topic, reason: ReprocessRejectReason.reached_limit}, wait.limited);
          gauges.reject.set({topic, reason: ReprocessRejectReason.expired}, wait.expired);
          if (wait.resolved) gauges.waitSecBeforeResolve.set({topic}, wait.resolveSeconds);
          if (wait.expired)
            gauges.waitSecBeforeReject.set({topic, reason: ReprocessRejectReason.expired}, wait.expireSeconds);
        }
      }
      metrics.awaitingBlockGossipMessages.countPerSlot.set(awaitingBlock);
      metrics.awaitingPayloadGossipMessages.countPerSlot.set(awaitingPayload);
      queue.keyAge.reset();
      for (const age of stats.keyAgeMs) queue.keyAge.observe(age / 1000);
    });
    this.wake();
  }

  private readonly wake = (): void => {
    if (!this.stopped && !this.retrying && !this.immediate) this.immediate = setImmediate(this.drain);
  };

  private readonly drain = (): void => {
    this.immediate = undefined;
    clearTimeout(this.timer);
    if (this.stopped) return;
    const wasRetrying = this.retrying;
    this.retrying = false;
    try {
      this.drainOnce();
    } catch (error) {
      if (this.stopped) return;
      const closed = error instanceof Error && "code" in error && error.code === "GossipQueueClosed";
      if (!wasRetrying || closed) {
        this.modules.logger.error("Failed to drain native gossip queue", {queueId: this.id}, error as Error);
      }
      if (closed) {
        void this.stop();
        return;
      }
      clearImmediate(this.immediate);
      this.immediate = undefined;
      this.retrying = true;
      this.timer = setTimeout(this.drain, DRAIN_RETRY_MS);
    }
  };

  private drainOnce(): void {
    const {chain, logger} = this.modules;
    const reason = !chain.blsThreadPoolCanAcceptWork()
      ? CannotAcceptWorkReason.bls
      : !chain.regenCanAcceptWork()
        ? CannotAcceptWorkReason.regen
        : null;
    const known = new Map<string, boolean>();
    const checks = gossipQueues.checks(this.id, Math.max(0, chain.clock.currentSlot));
    const tokens = new BigUint64Array(checks.length);
    const decisions = new Uint8Array(checks.length);
    for (const [i, check] of checks.entries()) {
      tokens[i] = check.token;
      try {
        decisions[i] = this.fatalPeers.has(check.peerId)
          ? gossipDependencyDecision.fatalPeer
          : this.checkDependency(check, known);
      } catch (error) {
        logger.error("Error checking native gossip dependency", {slot: check.slot}, error as Error);
        decisions[i] =
          check.kind === GossipType.beacon_block ? gossipDependencyDecision.ready : gossipDependencyDecision.awaitBlock;
      }
    }
    if (this.stopped) return;
    const {jobs, delay, blocked} = gossipQueues.drain(this.id, reason === null, tokens, decisions);
    if (blocked && reason !== null) this.modules.metrics?.networkProcessor.canNotAcceptWork.inc({reason});
    if (jobs.length)
      this.modules.metrics?.networkProcessor.jobsSubmitted.observe(jobs.reduce((count, job) => count + job.length, 0));
    for (const job of jobs)
      void this.processJob(job).catch((error) => logger.error("Error executing native gossip job", {}, error));
    if (delay === 0) this.wake();
    else if (delay > 0) this.timer = setTimeout(this.wake, delay);
  }

  private async processJob(job: GossipDelivery[]): Promise<void> {
    const {events, metrics, core} = this.modules;
    const started = Date.now() / 1000;
    const messages: PendingGossipsubMessage[] = [];
    const tokens: bigint[] = [];
    let results: TopicValidatorResult[] = [];
    try {
      for (const item of job) {
        const message = this.decode(item, started);
        const type = message.topic.type;
        if (this.fatalPeers.has(message.propagationSource)) {
          metrics?.networkProcessor.gossipValidationError.inc({topic: type, error: GossipErrorCode.FATAL_PEER});
          continue;
        }
        metrics?.gossipValidationQueue.queueTime.observe({topic: type}, item.queueSeconds);
        metrics?.gossipValidationQueue.jobWaitTime.observe(
          {topic: type},
          Math.max(0, started - message.seenTimestampSec)
        );
        tokens.push(item.token);
        messages.push(message);
      }
      if (messages.length === 0) return;
      const first = messages[0];
      if (first.msgSlot === undefined && this.slotted[first.topic.type]) {
        const code = GossipErrorCode.INVALID_SLOT;
        core.reportPeer(first.propagationSource, rejectPeerAction(first.topic.type, code), code);
        metrics?.networkProcessor.gossipValidationReject.inc({topic: first.topic.type});
        results = [TopicValidatorResult.Reject];
      } else {
        const infos = messages.map((msg) => ({...msg, msgSlot: msg.msgSlot ?? null}));
        results =
          first.topic.type === GossipType.beacon_attestation
            ? await this.validateBatch(infos)
            : [await this.validate(infos[0])];
      }
    } finally {
      if (!this.stopped) {
        let i = 0;
        for (const item of job) {
          const skipped = item.token !== tokens[i];
          const live = gossipQueues.complete(this.id, item.token, skipped);
          if (skipped) continue;
          const message = messages[i];
          const acceptance = results[i++] ?? TopicValidatorResult.Ignore;
          if (!live) continue;
          events.emit(NetworkEvent.gossipMessageValidationResult, {
            msgId: message.msgId,
            propagationSource: message.propagationSource,
            acceptance,
          });
          if (acceptance === TopicValidatorResult.Accept)
            metrics?.gossipValidationQueue.jobTime.observe(
              {topic: message.topic.type},
              (Date.now() / 1000 - started) / messages.length
            );
        }
        this.wake();
      }
    }
  }

  private decode(
    item: Pick<GossipDelivery, "data" | "context"> & Partial<Pick<GossipDelivery, "group" | "slot">>,
    started: number | null
  ): PendingGossipsubMessage {
    const receipt: GossipReceipt = JSON.parse(item.context);
    return {
      ...receipt,
      topic: this.topics.getTopic(receipt.topic),
      msg: {type: "unsigned", topic: receipt.topic, data: item.data},
      startProcessUnixSec: started,
      msgSlot: item.slot ?? undefined,
      indexed: item.group ? Buffer.from(item.group).toString("base64") : undefined,
    };
  }

  private checkDependency(check: DependencyCheck, blocks: Map<string, boolean>): GossipDependencyDecision {
    const {forkChoice} = this.modules.chain;
    const root = `0x${Buffer.from(check.root).toString("hex")}`;
    const slotRoot = {slot: check.slot, root};
    const source = BlockInputSource.network_processor;
    const currentSlot = this.modules.chain.clock.currentSlot;
    const maySearch =
      slotRoot.slot > currentSlot - MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE &&
      slotRoot.slot <= currentSlot + 1 &&
      this.searches.hasRoom(slotRoot, check.peerId);
    let blockKnown = blocks.get(root);
    if (blockKnown === undefined) {
      blockKnown = forkChoice.hasBlockHexUnsafe(root);
      blocks.set(root, blockKnown);
    }
    if (!blockKnown && maySearch) this.searchUnknownBlock(slotRoot, source, check.peerId);
    if (check.kind === GossipType.beacon_block || check.kind === GossipType.execution_payload_bid) {
      if (check.parentBlockHash !== null) {
        const hash = `0x${Buffer.from(check.parentBlockHash).toString("hex")}`;
        if (!forkChoice.getBlockHexAndBlockHash(root, hash)) {
          const parent = forkChoice.getBlockHexDefaultStatus(root);
          if (parent?.executionPayloadBlockHash && parent.executionPayloadBlockHash !== hash) {
            if (maySearch) this.searchUnknownEnvelope(slotRoot, source, check.peerId);
            return check.kind === GossipType.beacon_block
              ? gossipDependencyDecision.ready
              : gossipDependencyDecision.awaitPayload;
          }
        }
      }
      return check.kind === GossipType.beacon_block || blockKnown
        ? gossipDependencyDecision.ready
        : gossipDependencyDecision.awaitBlock;
    }
    if (
      (check.kind === GossipType.beacon_attestation || check.kind === GossipType.beacon_aggregate_and_proof) &&
      check.payloadPresent &&
      !forkChoice.hasPayloadHexUnsafe(root)
    ) {
      if (maySearch) this.searchUnknownEnvelope(slotRoot, source, check.peerId);
      return gossipDependencyDecision.awaitPayload;
    }
    if (
      (check.kind === GossipType.data_column_sidecar ||
        (check.kind === GossipType.payload_attestation_message && check.payloadPresent)) &&
      !forkChoice.hasPayloadHexUnsafe(root) &&
      maySearch
    )
      this.searchUnknownEnvelope(slotRoot, source, undefined, true);
    return blockKnown ? gossipDependencyDecision.ready : gossipDependencyDecision.awaitBlock;
  }

  searchUnknownBlock(slotRoot: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (!this.stopped) this.searches.searchUnknownBlock(slotRoot, source, peer);
  }
  searchUnknownEnvelope(
    slotRoot: SlotRootHex,
    source: BlockInputSource,
    peer?: PeerIdStr,
    slotIsPayloadSlot = false
  ): void {
    if (!this.stopped) this.searches.searchUnknownEnvelope(slotRoot, source, peer, slotIsPayloadSlot);
  }

  private readonly onBlock = ({block}: {block: string}): void => this.notify(block);
  private readonly onPayload = ({blockRoot}: {blockRoot: string}): void => this.notify(blockRoot);
  private notify(root: string): void {
    gossipQueues.notify(this.id, Buffer.from(root.slice(2), "hex"));
    this.wake();
  }
  dropAllJobs(): void {
    if (this.stopped) return;
    this.searches.clear();
    for (const peer of this.fatalPeers.keys()) gossipQueues.setPeerFatal(this.id, peer, false);
    this.fatalPeers.clear();
    gossipQueues.dropQueued(this.id);
    this.wake();
  }
  dumpGossipQueue(type: GossipType): PendingGossipsubMessage[] {
    if (this.stopped) return [];
    return gossipQueues.dump(this.id, type).map((item) => this.decode(item, null));
  }
  private readonly onSlot = (slot: number): void => {
    this.searches.prune(slot - MAX_UNKNOWN_ROOTS_SLOT_CACHE_SIZE);
    for (const [peer, since] of this.fatalPeers) {
      if (slot - since > FATAL_PEER_EXPIRY_SLOTS) {
        gossipQueues.setPeerFatal(this.id, peer, false);
        this.fatalPeers.delete(peer);
      }
    }
    this.wake();
  };
  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    clearImmediate(this.immediate);
    clearTimeout(this.timer);
    this.modules.chain.clock.off(ClockEvent.slot, this.onSlot);
    this.modules.events.off(NetworkEvent.gossipQueueReady, this.wake);
    this.modules.chain.emitter.off(ChainEvent.validationCapacity, this.wake);
    this.modules.chain.emitter.off(routes.events.EventType.block, this.onBlock);
    this.modules.chain.emitter.off(routes.events.EventType.executionPayload, this.onPayload);
    gossipQueues.close(this.id);
  }
}
