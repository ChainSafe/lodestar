import {TopicValidatorResult} from "@libp2p/gossipsub";
import {DependencyCheck} from "@chainsafe/lodestar-z/network";
import {routes} from "@lodestar/api";
import {SlotRootHex} from "@lodestar/types";
import {BlockInputSource} from "../../../chain/blocks/blockInput/types.js";
import {ChainEvent} from "../../../chain/emitter.js";
import {PeerIdStr} from "../../../util/peerId.js";
import {GossipMessageInfo, GossipType} from "../../gossip/interface.js";
import {MAX_PEERS_PER_ROOT} from "../../processor/constants.js";
import {getGossipHandlers} from "../../processor/gossipHandlers.js";
import {getGossipValidatorBatchFn, getGossipValidatorFn} from "../../processor/gossipValidatorFn.js";
import {MAX_SEARCHED_ROOTS_PER_SLOT, NetworkProcessorModules, NetworkProcessorOpts} from "../../processor/index.js";
import {PendingGossipsubMessage} from "../../processor/types.js";
import {NativeNetworkError, NativeNetworkErrorCode} from "./errors.js";
import {NativeGossip} from "./gossip.js";

export class NativeGossipExecutor {
  private readonly validate;
  private readonly validateBatch;
  private stopped = false;
  private readonly searches = new Map<number, Map<string, {peers: Set<PeerIdStr>; payloadSlotEmitted: boolean}>>();

  constructor(
    private readonly modules: NetworkProcessorModules,
    opts: NetworkProcessorOpts,
    private readonly gossip: Pick<NativeGossip, "attach" | "notifyBlock" | "dropQueued">
  ) {
    const handlers = modules.gossipHandlers ?? getGossipHandlers(modules, opts);
    // Native purges queued work when the owner applies the fatal report.
    const onFatalPeer = (): void => {};
    this.validate = getGossipValidatorFn(handlers, modules, onFatalPeer);
    this.validateBatch = getGossipValidatorBatchFn(handlers, modules, onFatalPeer);
    gossip.attach(this);
    modules.chain.emitter.on(routes.events.EventType.block, this.onBlock);
    modules.chain.emitter.on(routes.events.EventType.executionPayload, this.onPayload);
  }

  check(checks: readonly DependencyCheck[]): boolean[] {
    const blocks = new Map<string, boolean>();
    return checks.map((check) => this.checkDependency(check, blocks));
  }

  private checkDependency(check: DependencyCheck, blocks: Map<string, boolean>): boolean {
    const {forkChoice} = this.modules.chain;
    const root = `0x${Buffer.from(check.root).toString("hex")}`;
    const slotRoot = {slot: Number(check.slot), root};
    const source = BlockInputSource.network_processor;
    let blockKnown = blocks.get(root);
    if (blockKnown === undefined) {
      blockKnown = forkChoice.hasBlockHexUnsafe(root);
      blocks.set(root, blockKnown);
    }
    if (!blockKnown) this.searchUnknownBlock(slotRoot, source, check.peerId);
    if (check.kind === GossipType.beacon_block || check.kind === GossipType.execution_payload_bid) {
      if (check.parentBlockHash !== null) {
        const hash = `0x${Buffer.from(check.parentBlockHash).toString("hex")}`;
        if (!forkChoice.getBlockHexAndBlockHash(root, hash)) {
          const parent = forkChoice.getBlockHexDefaultStatus(root);
          if (parent?.executionPayloadBlockHash && parent.executionPayloadBlockHash !== hash) {
            this.searchUnknownEnvelope(slotRoot, source, check.peerId);
            return check.kind === GossipType.beacon_block;
          }
        }
      }
      return check.kind === GossipType.beacon_block || blockKnown;
    }
    if (
      (check.kind === GossipType.beacon_attestation || check.kind === GossipType.beacon_aggregate_and_proof) &&
      check.payloadPresent &&
      !forkChoice.hasPayloadHexUnsafe(root)
    ) {
      this.searchUnknownEnvelope(slotRoot, source, check.peerId);
      return false;
    }
    if (
      (check.kind === GossipType.data_column_sidecar ||
        (check.kind === GossipType.payload_attestation_message && check.payloadPresent)) &&
      !forkChoice.hasPayloadHexUnsafe(root)
    )
      this.searchUnknownEnvelope(slotRoot, source, undefined, true);
    return blockKnown;
  }

  /** Whether the chain takes validation work now. */
  ready(): boolean {
    const {chain} = this.modules;
    return chain.blsThreadPoolCanAcceptWork() && chain.regenCanAcceptWork();
  }

  /** Validates one job before its handlers run deferred import work. */
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

  observe(messages: PendingGossipsubMessage[], results: readonly TopicValidatorResult[]): void {
    for (const [index, message] of messages.entries()) {
      if (message.startProcessUnixSec === null || results[index] !== TopicValidatorResult.Accept) continue;
      this.modules.metrics?.gossipValidationQueue.jobTime.observe(
        {topic: message.topic.type},
        Math.max(0, Date.now() / 1000 - message.startProcessUnixSec) / messages.length
      );
    }
  }

  searchUnknownBlock({slot, root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (this.stopped || this.modules.chain.seenBlock(root)) return;
    if (!this.reserveSearch(slot, root, "block", peer)) return;
    this.modules.chain.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: root, peer, source});
  }

  searchUnknownEnvelope(
    {slot, root}: SlotRootHex,
    source: BlockInputSource,
    peer?: PeerIdStr,
    slotIsPayloadSlot = false
  ): void {
    if (this.stopped || this.modules.chain.seenPayloadEnvelope(root)) return;
    if (!this.reserveSearch(slot, root, "payload", peer, slotIsPayloadSlot)) return;
    if (slotIsPayloadSlot)
      this.modules.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {rootHex: root, slot, peer, source});
    else this.modules.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex: root, peer, source});
  }

  private reserveSearch(
    slot: number,
    root: string,
    target: "block" | "payload",
    peer?: PeerIdStr,
    payloadSlot = false
  ): boolean {
    const currentSlot = this.modules.chain.clock.currentSlot;
    if (!Number.isSafeInteger(slot) || slot < currentSlot - 2 || slot > currentSlot + 1) return false;
    for (const tracked of this.searches.keys()) if (tracked < currentSlot - 2) this.searches.delete(tracked);
    let roots = this.searches.get(slot);
    const key = `${target}:${root}`;
    const entry = roots?.get(key);
    const peers = entry?.peers;
    const needsPayloadSlot = payloadSlot && !entry?.payloadSlotEmitted;
    if (!needsPayloadSlot && (peers?.has(peer ?? "") || (peers?.size ?? 0) >= MAX_PEERS_PER_ROOT)) return false;
    if (!entry) {
      if ((roots?.size ?? 0) >= MAX_SEARCHED_ROOTS_PER_SLOT) return false;
      let fromPeer = 0;
      for (const sources of roots?.values() ?? []) if (sources.peers.has(peer ?? "")) fromPeer++;
      if (peer !== undefined && fromPeer >= 4) return false;
    }
    if (!roots) {
      roots = new Map();
      this.searches.set(slot, roots);
    }
    if (entry) {
      if (entry.peers.size < MAX_PEERS_PER_ROOT) entry.peers.add(peer ?? "");
      entry.payloadSlotEmitted ||= payloadSlot;
    } else roots.set(key, {peers: new Set([peer ?? ""]), payloadSlotEmitted: payloadSlot});
    return true;
  }

  private readonly onBlock = ({block}: {block: string}): void => {
    this.gossip.notifyBlock(Buffer.from(block.slice(2), "hex"));
  };
  private readonly onPayload = ({blockRoot}: {blockRoot: string}): void => {
    this.gossip.notifyBlock(Buffer.from(blockRoot.slice(2), "hex"));
  };
  subscribeCapacity(wake: () => void): () => void {
    const {emitter} = this.modules.chain;
    emitter.on(ChainEvent.validationCapacity, wake);
    return () => {
      emitter.off(ChainEvent.validationCapacity, wake);
    };
  }

  dropAllJobs(): void {
    this.gossip.dropQueued();
    this.searches.clear();
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
    this.modules.chain.emitter.off(routes.events.EventType.block, this.onBlock);
    this.modules.chain.emitter.off(routes.events.EventType.executionPayload, this.onPayload);
    this.dropAllJobs();
  }
}
