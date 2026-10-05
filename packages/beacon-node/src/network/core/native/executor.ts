import {TopicValidatorResult} from "@libp2p/gossipsub";
import {DependencyCheck} from "@chainsafe/lodestar-z/network";
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

  constructor(
    private readonly modules: NetworkProcessorModules,
    opts: NetworkProcessorOpts,
    private readonly gossip: Pick<NativeGossip, "attach" | "notifyBlock" | "dropQueued">,
    private readonly wake: () => void
  ) {
    const handlers = modules.gossipHandlers ?? getGossipHandlers(modules, opts);
    // Native owns the validation queue; peer bans go through core.reportPeer.
    const onFatalPeer = (): void => {};
    this.validate = getGossipValidatorFn(handlers, modules, onFatalPeer);
    this.validateBatch = getGossipValidatorBatchFn(handlers, modules, onFatalPeer);
    gossip.attach(this);
    modules.chain.emitter.on(routes.events.EventType.block, this.onBlock);
    modules.chain.clock.on(ClockEvent.slot, this.onSlot);
  }

  /** Whether each check's block is known; an unknown one starts a search. */
  check(checks: readonly DependencyCheck[]): boolean[] {
    const roots = new Map<string, {available: boolean; peers: Set<PeerIdStr>}>();
    return checks.map((check) => {
      const root = `0x${Buffer.from(check.root).toString("hex")}`;
      let entry = roots.get(root);
      if (entry === undefined) {
        entry = {available: this.modules.chain.forkChoice.hasBlockHexUnsafe(root), peers: new Set()};
        roots.set(root, entry);
      }
      if (!entry.available && !entry.peers.has(check.peerId)) {
        entry.peers.add(check.peerId);
        this.searchUnknownBlock({slot: Number(check.slot), root}, BlockInputSource.network_processor, check.peerId);
      }
      return entry.available;
    });
  }

  /** Whether the chain takes validation work now. */
  ready(): boolean {
    const {chain} = this.modules;
    return chain.blsThreadPoolCanAcceptWork() && chain.regenCanAcceptWork();
  }

  /** Validates one job. Its handlers' deferred work waits for `reported`: the owner's disposition of the verdicts. */
  async execute(
    messages: PendingGossipsubMessage[],
    grouped: boolean,
    reported: Promise<void>
  ): Promise<TopicValidatorResult[]> {
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
      ? this.validateBatch(infos, reported)
      : [await this.validate(infos[0], reported)];
  }

  observe(messages: PendingGossipsubMessage[]): void {
    for (const message of messages) {
      if (message.startProcessUnixSec === null) continue;
      this.modules.metrics?.gossipValidationQueue.jobTime.observe(
        {topic: message.topic.type},
        Math.max(0, Date.now() / 1000 - message.startProcessUnixSec) / messages.length
      );
    }
  }

  searchUnknownBlock({root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr): void {
    if (this.stopped || this.modules.chain.seenBlock(root)) return;
    this.modules.chain.emitter.emit(ChainEvent.unknownBlockRoot, {rootHex: root, peer, source});
  }

  searchUnknownEnvelope({slot, root}: SlotRootHex, source: BlockInputSource, peer?: PeerIdStr, slotIsPayloadSlot = false): void {
    if (this.stopped || this.modules.chain.seenPayloadEnvelope(root)) return;
    if (slotIsPayloadSlot) this.modules.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRootSlot, {rootHex: root, slot, peer, source});
    else this.modules.chain.emitter.emit(ChainEvent.unknownEnvelopeBlockRoot, {rootHex: root, peer, source});
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
    this.modules.chain.emitter.off(routes.events.EventType.block, this.onBlock);
    this.modules.chain.clock.off(ClockEvent.slot, this.onSlot);
    this.dropAllJobs();
  }
}
