import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {RootHex, SignedBeaconBlock} from "@lodestar/types";
import {Logger, toRootHex} from "@lodestar/utils";
import {ChainEvent, ChainEventData} from "../../chain/emitter.js";
import {IBeaconChain} from "../../chain/interface.js";
import {TargetSyncBlockRepository} from "../../db/repositories/index.js";
import {Metrics} from "../../metrics/index.js";
import {NetworkEvent, NetworkEventData} from "../../network/events.js";
import {INetwork} from "../../network/interface.js";
import {PeerAction} from "../../network/peers/score/index.js";
import {assertPeerRelevance} from "../../network/peers/utils/assertPeerRelevance.js";
import {ClockEvent} from "../../util/clock.js";
import {ItTrigger} from "../../util/itTrigger.js";
import {PeerIdStr} from "../../util/peerId.js";
import {SyncChainDebugState, SyncChainStatus} from "../range/chain.js";
import {classifyMissingDependency} from "../utils/missingDependency.js";
import {RangeSyncType, getRangeSyncTarget} from "../utils/remoteSyncType.js";
import {FillPool} from "./fillPool.js";
import {toHeaderChainElement} from "./headerChain.js";
import {ImportStepResult, importNextSegment} from "./importer.js";
import {InvalidBytesLedger, QuotaLedger, defaultQuotaLimits} from "./quotaLedger.js";
import {ScoringGate} from "./scoring.js";
import {DEFAULT_SPILL_QUOTAS, SpillStoreGlobal} from "./spillStore.js";
import {TargetStore, UpsertClaim} from "./targetStore.js";
import {Target, TargetWaiter} from "./types.js";
import {walkHop} from "./walker.js";

// ---------------------------------------------------------------------------
// TargetSync — the engine facade: event routing, the scheduler loop, and the
// close lifecycle.
//
// Routing table (canonical): every event goes to the mechanism that owns it —
//   unknownBlockRoot            → BlockFill (fetch by root, gossip-source hint)
//   unknownEnvelopeBlockRoot    → EnvelopeFill
//   incompleteBlockInput        → ColumnFill (block input)
//   incompletePayloadEnvelope   → ColumnFill (payload input)
//   blockUnknownParent          → classify:
//       ready               → ColumnFill/process (importable now)
//       block               → BlockFill
//       parentBlock         → TARGET the parent + stash the child as waiter
//       parentPayload       → EnvelopeFill(parent) + child re-driven on payload import
//       invalidParentPayload→ score the advertising peer
//   peerConnected (relevant)    → admission-gated finalized/head target
//   forkChoiceFinalized         → prune below-floor targets
//   ClockEvent.slot             → liveness scan (parks, fills, ledgers) [I2 backstop]
//
// Lifecycle: one root AbortController threaded through every component;
// close() is SYNCHRONOUS — abort, unsubscribe, drop state, zero db writes
// (the unconditional boot wipe owns the rows) [A1][A12].
// ---------------------------------------------------------------------------

/** Concurrent backward walks (dossier §2.1). */
const MAX_CONCURRENT_WALKS = 2;
/** parentPayload children waiting for a parent's payload import (drop-oldest). */
const CHILD_WAITERS_MAX = 256;
/** Scoring dedup window (per peer+reason). */
const SCORING_COOLDOWN_MS = 30_000;

export type TargetSyncModules = {
  config: BeaconConfig;
  chain: IBeaconChain;
  network: INetwork;
  logger: Logger;
  metrics: Metrics | null;
  targetSyncBlocks: TargetSyncBlockRepository;
  /** [A1] Walks are gated on the unconditional boot wipe completing. */
  spillWiped?: Promise<number>;
  /** Fired on every target completion (BeaconSync re-derives SyncState immediately). */
  onCompleted?: () => void;
};

export class TargetSync {
  private readonly abort = new AbortController();
  private readonly trigger = new ItTrigger();
  private readonly ledger: QuotaLedger;
  private readonly invalidBytes = new InvalidBytesLedger();
  private readonly spillGlobal: SpillStoreGlobal;
  private readonly store: TargetStore;
  private readonly fills: FillPool;
  private readonly gate = new ScoringGate({cooldownMs: SCORING_COOLDOWN_MS, now: Date.now});
  /** parentRoot → child roots re-driven when the parent's payload imports. */
  private readonly childWaiters = new Map<RootHex, Set<RootHex>>();
  private readonly activeWalks = new Set<RootHex>();
  private activeImport: RootHex | null = null;
  /** [A1] No walk dispatch until the boot wipe has finished. */
  private ready = false;
  private started = false;

  constructor(private readonly modules: TargetSyncModules) {
    const {config, chain, network, logger, metrics} = modules;

    this.ledger = new QuotaLedger(defaultQuotaLimits(config));
    this.spillGlobal = new SpillStoreGlobal(
      modules.targetSyncBlocks,
      DEFAULT_SPILL_QUOTAS,
      logger,
      metrics?.targetSync ?? null
    );

    this.store = new TargetStore({
      now: Date.now,
      finalizedSlot: () => chain.forkChoice.getFinalizedCheckpointSlot(),
      hasBlockHex: (root) => chain.forkChoice.hasBlockHex(root),
      createSpill: (root) => this.spillGlobal.forTarget(root),
      invalidBytes: this.invalidBytes,
      reportPeerMid: (peer, reason) => this.gate.report(network, peer, reason, PeerAction.MidToleranceError),
      reportPeerLow: (peer, reason) => this.gate.report(network, peer, reason, PeerAction.LowToleranceError),
      onWaiters: (waiters) => this.reEmitWaiters(waiters),
      onCompleted: (target) => this.onTargetCompleted(target),
      logger,
      signal: this.abort.signal,
    });

    if (metrics !== null) {
      // Gauge collection: FSM/fill state + terminal outcomes, sampled at scrape time.
      metrics.targetSync.targetsByState.addCollect(() => {
        const counts = this.store.counts;
        for (const state of ["queued", "walking", "parked", "importing", "awaitingOwner"]) {
          metrics.targetSync.targetsByState.set({state}, counts.byStatus[state] ?? 0);
        }
        for (const [result, count] of Object.entries(this.store.terminals)) {
          metrics.targetSync.targetsTerminalTotal.set({result}, count);
        }
        const fillStats = this.fills.stats;
        metrics.targetSync.fillTasks.set({state: "active"}, fillStats.active);
        metrics.targetSync.fillTasks.set({state: "queued"}, fillStats.queued);
        metrics.targetSync.fillTasks.set({state: "waiting"}, fillStats.waiting);
        metrics.targetSync.activeChains.set(counts.live);
      });
    }

    this.fills = new FillPool({
      config,
      chain,
      network,
      ledger: this.ledger,
      connectedPeers: () => network.getConnectedPeers(),
      reportPeer: (peer, reason) => this.gate.report(network, peer, reason, PeerAction.LowToleranceError),
      onBlockFetched: (root, block, peer) => this.seedTarget(root, block, peer),
      onPayloadProcessed: (root) => this.onPayloadProcessed(root),
      escalate: (root, waiter) => this.upsertTarget({root, kind: "byRoot", waiter}),
      logger,
      signal: this.abort.signal,
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.started) return;
    this.started = true;
    const {chain, network} = this.modules;

    chain.emitter.on(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
    chain.emitter.on(ChainEvent.unknownEnvelopeBlockRoot, this.onUnknownEnvelopeBlockRoot);
    chain.emitter.on(ChainEvent.blockUnknownParent, this.onBlockUnknownParent);
    chain.emitter.on(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
    chain.emitter.on(ChainEvent.incompletePayloadEnvelope, this.onIncompletePayloadEnvelope);
    chain.emitter.on(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
    // Import events (the SSE event types double as internal chain events — the same wake
    // source the canonical BlockInputSync uses): block import wakes envelope fills parked
    // on the block; payload import releases parentPayload children. The per-slot scans
    // remain as the lost-event backstop (I2).
    chain.emitter.on(routes.events.EventType.block, this.onBlockImported);
    chain.emitter.on(routes.events.EventType.executionPayload, this.onPayloadImported);
    chain.clock.on(ClockEvent.slot, this.onSlot);
    network.events.on(NetworkEvent.peerConnected, this.onPeerConnected);

    void this.runLoop();
    void (this.modules.spillWiped ?? Promise.resolve(0)).then(() => {
      this.ready = true;
      this.wake();
    });
  }

  /**
   * SYNCHRONOUS close: abort every in-flight walk/fill/import, detach all
   * listeners, drop all state. Issues ZERO db writes — the unconditional boot
   * wipe owns whatever rows remain [A1][A12].
   */
  stop(): void {
    if (!this.started) return;
    this.started = false;
    const {chain, network} = this.modules;

    this.abort.abort();

    chain.emitter.off(ChainEvent.unknownBlockRoot, this.onUnknownBlockRoot);
    chain.emitter.off(ChainEvent.unknownEnvelopeBlockRoot, this.onUnknownEnvelopeBlockRoot);
    chain.emitter.off(ChainEvent.blockUnknownParent, this.onBlockUnknownParent);
    chain.emitter.off(ChainEvent.incompleteBlockInput, this.onIncompleteBlockInput);
    chain.emitter.off(ChainEvent.incompletePayloadEnvelope, this.onIncompletePayloadEnvelope);
    chain.emitter.off(ChainEvent.forkChoiceFinalized, this.onForkChoiceFinalized);
    chain.emitter.off(routes.events.EventType.block, this.onBlockImported);
    chain.emitter.off(routes.events.EventType.executionPayload, this.onPayloadImported);
    chain.clock.off(ClockEvent.slot, this.onSlot);
    network.events.off(NetworkEvent.peerConnected, this.onPeerConnected);

    this.store.abortAll();
    this.fills.clear();
    this.childWaiters.clear();
    this.trigger.end();
  }

  // -------------------------------------------------------------------------
  // Sync-state API (BeaconSync)
  // -------------------------------------------------------------------------

  get activeChainCount(): number {
    return this.store.targets.size;
  }

  get isSyncingFinalized(): boolean {
    return this.store.hasFinalizedKind;
  }

  // -------------------------------------------------------------------------
  // Scheduler loop
  // -------------------------------------------------------------------------

  private wake(): void {
    this.trigger.trigger();
  }

  private async runLoop(): Promise<void> {
    try {
      for await (const _ of this.trigger) {
        if (this.abort.signal.aborted) return;
        if (!this.ready) continue;
        this.dispatchWalks();
        this.dispatchImport();
      }
    } catch (e) {
      if (!this.abort.signal.aborted) {
        this.modules.logger.error("TargetSync scheduler loop crashed", {}, e as Error);
      }
    }
  }

  private dispatchWalks(): void {
    const {chain} = this.modules;
    for (const target of this.store.pickWalkers(MAX_CONCURRENT_WALKS + this.activeWalks.size)) {
      if (this.activeWalks.size >= MAX_CONCURRENT_WALKS) return;
      if (this.activeWalks.has(target.root)) continue;

      // The anchor is already known — the walk completes without a hop
      // (near-head case, and the post-owner-completion resume).
      if (chain.forkChoice.hasBlockHex(target.walkAnchor)) {
        this.store.markIntersected(target);
        this.wake();
        continue;
      }

      this.activeWalks.add(target.root);
      target.status = {kind: "walking"};
      const prevLen = target.headerChain.length;
      void walkHop(target, {
        config: this.modules.config,
        hopBlocks: this.modules.config.MAX_REQUEST_BLOCKS_DENEB,
        currentSlot: () => chain.clock.currentSlot,
        forkChoice: chain.forkChoice,
        sendBeaconBlocksByHead: (peer, beaconRoot, count) =>
          this.modules.network.sendBeaconBlocksByHead(peer, {beaconRoot, count}),
        connectedPeers: () => this.modules.network.getConnectedPeers(),
        ledger: this.ledger,
        invalidBytes: this.invalidBytes,
        spill: target.spill,
        reportPeerLow: (peer, reason) =>
          this.gate.report(this.modules.network, peer, reason, PeerAction.LowToleranceError),
        signal: this.abort.signal,
      })
        .then((res) => {
          this.modules.metrics?.targetSync.walkHopsTotal.inc({outcome: res.outcome});
          this.store.onWalkResult(target, res, prevLen);
        })
        .catch((e) => {
          if (this.abort.signal.aborted) return;
          this.modules.logger.error("TargetSync walk hop crashed", {target: target.root}, e as Error);
          // Budgeted: repeated crashes drive the target to `exhausted`, never a wedge.
          this.store.onWalkResult(target, {outcome: "emptyHop"}, prevLen);
        })
        .finally(() => {
          this.activeWalks.delete(target.root);
          this.wake();
        });
    }
  }

  private dispatchImport(): void {
    if (this.activeImport !== null) return;
    const target = this.store.pickImporter();
    if (target === null) return;

    this.activeImport = target.root;
    void importNextSegment(target, {
      config: this.modules.config,
      chain: this.modules.chain,
      network: this.modules.network,
      ledger: this.ledger,
      connectedPeers: () => this.modules.network.getConnectedPeers(),
      reportPeer: (peer, reason) => this.gate.report(this.modules.network, peer, reason, PeerAction.LowToleranceError),
      signal: this.abort.signal,
    })
      .then((res) => {
        this.modules.metrics?.targetSync.importStepsTotal.inc({step: res.step});
        this.applyImportResult(target, res);
      })
      .catch((e) => {
        if (this.abort.signal.aborted) return;
        this.modules.logger.error("TargetSync import step crashed", {target: target.root}, e as Error);
        this.store.parkImportAttempt(target, "backoff");
      })
      .finally(() => {
        this.activeImport = null;
        this.wake();
      });
  }

  private applyImportResult(target: Target, res: ImportStepResult): void {
    switch (res.step) {
      case "segmentImported":
        // The per-segment slot was released; the next loop iteration re-grants by priority [A6].
        return;
      case "completed":
        this.store.terminal(target, "completed");
        return;
      case "notReady":
        this.store.parkImportAttempt(target, "awaitingData", true);
        return;
      case "parkParentPayload":
        this.fills.submit({kind: "envelope", root: res.parentRoot});
        this.addChildWaiter(res.parentRoot, target.root);
        this.store.parkImportAttempt(target, "awaitingParentPayload", true);
        return;
      case "park":
        this.store.parkImportAttempt(
          target,
          res.reason === "peerStarved" ? "backoff" : res.reason,
          res.reason === "awaitingData" || res.reason === "awaitingParentPayload"
        );
        return;
      case "invalid":
        this.store.terminal(target, "invalid", {firstInvalidRoot: res.firstInvalidRoot, reason: res.reason});
        return;
      case "reanchor":
        this.store.reanchor(target);
        return;
      case "internal":
        this.modules.logger.warn("TargetSync import internal fault", {target: target.root, reason: res.reason});
        this.modules.metrics?.targetSync.dataFillUnexpectedErrorTotal.inc();
        this.store.parkImportAttempt(target, "backoff");
        return;
      case "aborted":
        this.store.terminal(target, "aborted");
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Event routing
  // -------------------------------------------------------------------------

  private readonly onUnknownBlockRoot = (data: ChainEventData[ChainEvent.unknownBlockRoot]): void => {
    // The referencing message's slot upper-bounds the block's slot: at/below the finalized
    // floor the root is provably stale — drop before spending a fetch [A8].
    if (data.slot <= this.modules.chain.forkChoice.getFinalizedCheckpointSlot()) return;
    this.fills.submit({kind: "block", root: data.rootHex, hintPeer: data.peer});
  };

  private readonly onUnknownEnvelopeBlockRoot = (data: ChainEventData[ChainEvent.unknownEnvelopeBlockRoot]): void => {
    this.fills.submit({kind: "envelope", root: data.rootHex});
  };

  private readonly onIncompleteBlockInput = (data: ChainEventData[ChainEvent.incompleteBlockInput]): void => {
    this.fills.submit({
      kind: "columns",
      root: data.blockInput.blockRootHex,
      input: data.blockInput,
      inputKind: "block",
    });
  };

  private readonly onIncompletePayloadEnvelope = (data: ChainEventData[ChainEvent.incompletePayloadEnvelope]): void => {
    this.fills.submit({
      kind: "columns",
      root: data.payloadInput.blockRootHex,
      input: data.payloadInput,
      inputKind: "payload",
    });
  };

  private readonly onBlockUnknownParent = (data: ChainEventData[ChainEvent.blockUnknownParent]): void => {
    const {blockInput, peer} = data;
    const dep = classifyMissingDependency({config: this.modules.config, chain: this.modules.chain}, blockInput);
    switch (dep.kind) {
      case "ready":
        // Importable now — run it through the fill/process path.
        this.fills.submit({kind: "columns", root: blockInput.blockRootHex, input: blockInput, inputKind: "block"});
        break;
      case "block":
        this.fills.submit({kind: "block", root: dep.rootHex, hintPeer: peer});
        break;
      case "parentBlock":
        // Target the PARENT; the child rides as a waiter and is re-emitted on completion.
        this.upsertTarget({
          root: dep.rootHex,
          kind: "byRoot",
          peer,
          claimedRoot: blockInput.blockRootHex,
          waiter: {rootHex: blockInput.blockRootHex, peer},
        });
        break;
      case "parentPayload":
        // The parent block is known (PENDING); only its envelope is missing — a fill, never a walk.
        this.fills.submit({kind: "envelope", root: dep.rootHex});
        this.addChildWaiter(dep.rootHex, blockInput.blockRootHex);
        break;
      case "invalidParentPayload":
        this.gate.report(this.modules.network, peer, "invalidParentPayload", PeerAction.LowToleranceError);
        break;
    }
    this.wake();
  };

  private readonly onPeerConnected = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    const {chain, config} = this.modules;
    const local = chain.getStatus();
    const currentSlot = chain.clock.currentSlot;
    if (assertPeerRelevance(config.getForkName(currentSlot), data.status, local, currentSlot) !== null) return;

    const {syncType, target} = getRangeSyncTarget(local, data.status, chain);
    const rootHex = toRootHex(target.root);
    this.upsertTarget({
      root: rootHex,
      slotHint: target.slot,
      kind: syncType === RangeSyncType.Finalized ? "finalized" : "head",
      peer: data.peer,
      claimedRoot: rootHex,
    });
  };

  private readonly onForkChoiceFinalized = (cp: {epoch: number; rootHex: RootHex}): void => {
    this.store.onFinalized(computeStartSlotAtEpoch(cp.epoch));
    this.wake();
  };

  /** A block imported (any source): wake envelope fills parked on it. */
  private readonly onBlockImported = (data: routes.events.EventData[routes.events.EventType.block]): void => {
    this.fills.onBlockKnown(data.block);
    this.wake();
  };

  /** A payload imported (any source): release parentPayload children blocked on it. */
  private readonly onPayloadImported = (
    data: routes.events.EventData[routes.events.EventType.executionPayload]
  ): void => {
    this.onPayloadProcessed(data.blockRoot);
  };

  /** Per-slot liveness scan — the I2 backstop for every parked state. */
  private readonly onSlot = (): void => {
    this.store.onSlot();
    this.fills.onSlot();
    this.ledger.prune();
    this.invalidBytes.sweep();
    this.retryChildWaiters();
    this.wake();
  };

  // -------------------------------------------------------------------------
  // Target plumbing
  // -------------------------------------------------------------------------

  /** Admission-gated upsert; true when a live target now covers the root. */
  private upsertTarget(claim: UpsertClaim): boolean {
    if (this.abort.signal.aborted) return false;
    if (this.modules.chain.forkChoice.hasBlockHex(claim.root)) return false;
    const res = this.store.upsert(claim);
    if (res.result === "rejected") return false;
    this.wake();
    return true;
  }

  /**
   * A BlockFill fetched a block: admit a target seeded with the in-hand block —
   * a one-element pre-walked chain (the near-head shortcut, generalized).
   */
  private seedTarget(root: RootHex, block: SignedBeaconBlock, peer: PeerIdStr): void {
    const {chain, config} = this.modules;
    const res = this.store.upsert({
      root,
      slotHint: block.message.slot,
      kind: "byRoot",
      peer,
      claimedRoot: root,
    });
    if (res.result !== "admitted") {
      this.wake();
      return;
    }
    const target = res.target;
    const el = toHeaderChainElement(config, block, root);
    void target.spill
      .put(root, block, this.abort.signal)
      .then(() => {
        target.headerChain.push(el);
        target.walkAnchor = el.parentRoot;
        target.provenance.set(root, peer);
        if (chain.forkChoice.hasBlockHex(el.parentRoot)) {
          target.intersectionRoot = el.parentRoot;
          this.store.onWalkResult(target, {outcome: "intersected", intersectionRoot: el.parentRoot}, 0);
        } else {
          this.store.onWalkResult(target, {outcome: "progress"}, 0);
        }
        this.wake();
      })
      .catch((e) => {
        if (this.abort.signal.aborted) return;
        this.modules.logger.debug("TargetSync seed staging failed", {root}, e as Error);
        this.wake(); // target remains queued; the walk re-fetches
      });
  }

  /** Completed-target waiters: rehydrate from the seen cache and re-process [A10]. */
  private reEmitWaiters(waiters: TargetWaiter[]): void {
    const {chain} = this.modules;
    for (const waiter of waiters) {
      const input = chain.seenBlockInputCache.get(waiter.rootHex);
      if (input === undefined) continue; // evicted — gossip re-delivers
      this.fills.submit({kind: "columns", root: waiter.rootHex, input, inputKind: "block"});
    }
  }

  /** Operator debug view (beacon API): one row per live target. */
  getSyncChainsDebugState(): SyncChainDebugState[] {
    return [...this.store.targets.values()].map((t) => ({
      targetRoot: t.root,
      targetSlot: t.slotHint ?? t.headerChain.at(-1)?.slot ?? null,
      syncType: t.kind === "finalized" ? RangeSyncType.Finalized : RangeSyncType.Head,
      status: SyncChainStatus.Syncing,
      startEpoch: 0,
      peers: t.advocates.size,
      batches: [],
    }));
  }

  private onTargetCompleted(target: Target): void {
    // Completion is the one moment advocates are re-STATUSed (their head advanced past
    // this target while we walked it) — never a blanket per-epoch re-STATUS.
    const advocates = [...target.advocates.keys()];
    if (advocates.length > 0) {
      this.modules.network.reStatusPeers(advocates).catch((e) => {
        if (!this.abort.signal.aborted) {
          this.modules.logger.debug("TargetSync re-STATUS failed", {}, e as Error);
        }
      });
    }
    this.fills.onBlockKnown(target.root);
    this.onPayloadProcessed(target.root);
    this.modules.onCompleted?.();
  }

  // -------------------------------------------------------------------------
  // parentPayload child re-drive
  // -------------------------------------------------------------------------

  private addChildWaiter(parentRoot: RootHex, childRoot: RootHex): void {
    let children = this.childWaiters.get(parentRoot);
    if (children === undefined) {
      if (this.childWaiters.size >= CHILD_WAITERS_MAX) {
        const oldest = this.childWaiters.keys().next().value as RootHex;
        this.childWaiters.delete(oldest);
      }
      children = new Set();
      this.childWaiters.set(parentRoot, children);
    }
    children.add(childRoot);
  }

  private onPayloadProcessed(parentRoot: RootHex): void {
    const children = this.childWaiters.get(parentRoot);
    if (children === undefined) return;
    this.childWaiters.delete(parentRoot);
    const {chain} = this.modules;
    for (const childRoot of children) {
      const input = chain.seenBlockInputCache.get(childRoot);
      if (input !== undefined) {
        this.fills.submit({kind: "columns", root: childRoot, input, inputKind: "block"});
      }
      // Parked targets waiting on this parent resume via the per-slot scan.
    }
    this.wake();
  }

  /** Per-slot: parents whose payload arrived by other means (gossip) release their children. */
  private retryChildWaiters(): void {
    const {chain} = this.modules;
    for (const parentRoot of [...this.childWaiters.keys()]) {
      if (chain.seenPayloadEnvelope(parentRoot)) {
        this.onPayloadProcessed(parentRoot);
      }
    }
  }
}
