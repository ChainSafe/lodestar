import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq} from "@lodestar/params";
import {RequestError} from "@lodestar/reqresp";
import {RootHex, SignedBeaconBlock} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {IBlockInput} from "../../chain/blocks/blockInput/types.js";
import {PayloadError} from "../../chain/blocks/importExecutionPayload.js";
import {PayloadEnvelopeInput} from "../../chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {BlockError} from "../../chain/errors/blockError.js";
import {IBeaconChain} from "../../chain/interface.js";
import {INetwork} from "../../network/interface.js";
import {PeerIdStr} from "../../util/peerId.js";
import {DownloadByRootError, fetchAndValidateBlock} from "../utils/downloadByRoot.js";
import {dataFill} from "./dataFill.js";
import {classifyPayloadImportError, parkIfRateLimited} from "./errorPolicy.js";
import {fetchAndValidateExecutionPayloadEnvelopeByRoot} from "./fetchEnvelopeByRoot.js";
import {selectAndReservePeer} from "./peerSelection.js";
import {QuotaLedger} from "./quotaLedger.js";
import {TargetWaiter} from "./types.js";

// ---------------------------------------------------------------------------
// FillPool — by-root resolution for artifacts that must NOT become targets:
// single blocks, execution-payload envelopes, and data columns.
//
// This closes the engine's biggest routing hole: a gloas block imported as
// PENDING whose envelope/columns arrive late has NO walk to run — the target
// machinery short-circuits on `hasBlockHex` — so DA completion needs a
// dedicated by-root path ending in `chain.processExecutionPayload` /
// `chain.processBlock`.
//
// Pool discipline [A5]: a slot is held only during an ACTIVE network fetch.
// An EnvelopeFill whose block is unknown parks SLOTLESS in `waitingForBlock`
// (woken by block-import events and the per-slot scan) — parked work can
// never starve live work. Escalation to a full target is retried with a
// budget [A13] so an admission-gate rejection (cooldown) cannot silently
// drop the fill.
// ---------------------------------------------------------------------------

/** Concurrent active fetches (global, both task kinds). */
export const FILL_POOL_MAX_ACTIVE = 8;
/** Queued tasks beyond the active cap (drop-oldest; gossip re-delivers). */
export const FILL_QUEUE_MAX = 64;
/** Peer rotations per task before dropping it (events/scan re-drive). */
const FILL_TASK_ATTEMPTS_MAX = 3;
/** Escalation attempts for a block-less envelope fill before dropping [A13]. */
export const FILL_ESCALATION_ATTEMPTS_MAX = 3;

export type FillTask =
  /** Fetch a block by root (unknown-root gossip) and hand it to the facade for routing. */
  | {kind: "block"; root: RootHex; hintPeer?: PeerIdStr}
  /** Fetch + admit + process the payload envelope of a known (usually PENDING) block. */
  | {kind: "envelope"; root: RootHex}
  /** Complete a gossip input's columns, then process it. */
  | {kind: "columns"; root: RootHex; input: IBlockInput | PayloadEnvelopeInput; inputKind: "block" | "payload"};

export type FillPoolDeps = {
  config: ChainForkConfig;
  chain: IBeaconChain;
  network: INetwork;
  ledger: QuotaLedger;
  connectedPeers(): PeerIdStr[];
  /** Peer scoring pass-through (gated/deduped by the facade). */
  reportPeer(peerIdStr: PeerIdStr, reason: string): void;
  /** A fetched block for the facade to route (seed a target / near-head import). */
  onBlockFetched(root: RootHex, block: SignedBeaconBlock, peer: PeerIdStr): void;
  /** A payload envelope imported successfully (re-drive children blocked on it). */
  onPayloadProcessed(root: RootHex): void;
  /**
   * Escalate a root to the target machinery (e.g. a block-less envelope fill whose
   * block never arrives). Returns false when admission rejected it — the fill
   * stays parked and retries on the next scan [A13].
   */
  escalate(root: RootHex, waiter?: TargetWaiter): boolean;
  logger: Logger;
  signal: AbortSignal;
};

export class FillPool {
  private readonly active = new Set<string>();
  private readonly queued: FillTask[] = [];
  private readonly queuedKeys = new Set<string>();
  /** Slotless parking for envelope fills awaiting their block [A5]. */
  private readonly waitingForBlock = new Map<RootHex, {escalations: number}>();

  constructor(private readonly deps: FillPoolDeps) {}

  get stats(): {active: number; queued: number; waiting: number} {
    return {active: this.active.size, queued: this.queued.length, waiting: this.waitingForBlock.size};
  }

  /** Submit a task (deduped by kind:root). */
  submit(task: FillTask): void {
    if (this.deps.signal.aborted) return;
    const key = taskKey(task);
    if (this.active.has(key) || this.queuedKeys.has(key)) return;
    if (task.kind === "envelope" && this.waitingForBlock.has(task.root)) return;

    if (this.active.size >= FILL_POOL_MAX_ACTIVE) {
      this.queued.push(task);
      this.queuedKeys.add(key);
      if (this.queued.length > FILL_QUEUE_MAX) {
        const dropped = this.queued.shift();
        if (dropped !== undefined) this.queuedKeys.delete(taskKey(dropped));
      }
      return;
    }
    this.run(task, key);
  }

  /** A block became known/imported — wake any envelope fill parked on it. */
  onBlockKnown(root: RootHex): void {
    if (this.waitingForBlock.delete(root)) {
      this.submit({kind: "envelope", root});
    }
  }

  /** Per-slot scan: retry parked fills (escalating with budget [A13]) and drain the queue. */
  onSlot(): void {
    if (this.deps.signal.aborted) return;
    for (const [root, state] of this.waitingForBlock) {
      if (this.deps.chain.forkChoice.hasBlockHex(root)) {
        this.waitingForBlock.delete(root);
        this.submit({kind: "envelope", root});
        continue;
      }
      if (this.deps.escalate(root)) {
        // A target owns the root now; its completion re-delivers the block event.
        this.waitingForBlock.delete(root);
        continue;
      }
      state.escalations++;
      if (state.escalations >= FILL_ESCALATION_ATTEMPTS_MAX) {
        this.waitingForBlock.delete(root);
        this.deps.logger.debug("TargetSync envelope fill dropped after escalation budget", {root});
      }
    }
    this.drainQueue();
  }

  /** Drop everything (engine close). */
  clear(): void {
    this.queued.length = 0;
    this.queuedKeys.clear();
    this.waitingForBlock.clear();
  }

  private drainQueue(): void {
    while (this.active.size < FILL_POOL_MAX_ACTIVE) {
      const task = this.queued.shift();
      if (task === undefined) return;
      this.queuedKeys.delete(taskKey(task));
      this.run(task, taskKey(task));
    }
  }

  private run(task: FillTask, key: string): void {
    this.active.add(key);
    void this.dispatch(task)
      .catch((e) => {
        if (!this.deps.signal.aborted) {
          this.deps.logger.debug("TargetSync fill task failed", {kind: task.kind, root: task.root}, e as Error);
        }
      })
      .finally(() => {
        this.active.delete(key);
        this.drainQueue();
      });
  }

  private async dispatch(task: FillTask): Promise<void> {
    switch (task.kind) {
      case "block":
        return this.fillBlock(task);
      case "envelope":
        return this.fillEnvelope(task);
      case "columns":
        return this.fillColumns(task);
    }
  }

  // --- BlockFill -------------------------------------------------------------

  private async fillBlock(task: {root: RootHex; hintPeer?: PeerIdStr}): Promise<void> {
    const {deps} = this;
    const exclude = new Set<PeerIdStr>();
    for (let attempt = 0; attempt < FILL_TASK_ATTEMPTS_MAX; attempt++) {
      if (deps.signal.aborted) return;

      // Prefer the gossip source (it demonstrably has the block).
      let peer: PeerIdStr | null = null;
      if (
        task.hintPeer !== undefined &&
        !exclude.has(task.hintPeer) &&
        deps.ledger.tryReserve(task.hintPeer, "blocksByRoot", 1)
      )
        peer = task.hintPeer;
      peer ??= selectAndReservePeer({
        kind: "blocksByRoot",
        units: 1,
        ledger: deps.ledger,
        connected: deps.connectedPeers(),
        exclude,
      });
      if (peer === null) return; // quota-starved; gossip/scan re-drives

      try {
        const block = await fetchAndValidateBlock({
          config: deps.config,
          network: deps.network,
          peerIdStr: peer,
          blockRoot: fromHex(task.root),
        });
        deps.onBlockFetched(task.root, block, peer);
        return;
      } catch (e) {
        if (deps.signal.aborted) return;
        if (e instanceof DownloadByRootError) {
          // Served a block that does not match the requested root — provably bad.
          deps.reportPeer(peer, "block_root_mismatch");
        } else if (e instanceof RequestError) {
          parkIfRateLimited(deps.ledger, peer, e);
        }
        exclude.add(peer);
      } finally {
        deps.ledger.release(peer, "blocksByRoot");
      }
    }
  }

  // --- EnvelopeFill ----------------------------------------------------------

  private async fillEnvelope(task: {root: RootHex}): Promise<void> {
    const {deps} = this;
    const {chain, config} = deps;

    // The bid-binding admission needs the block itself.
    const local = await chain.getBlockByRoot(task.root).catch(() => null);
    if (local == null) {
      // Slotless park [A5]: woken by block events / per-slot scan, escalating with budget.
      this.waitingForBlock.set(task.root, {escalations: 0});
      return;
    }
    const block = local.block;
    if (config.getForkSeq(block.message.slot) < ForkSeq.gloas) return; // nothing to fill

    // Already have a complete input? Skip straight to processing.
    let payloadInput = chain.seenPayloadEnvelopeInputCache.get(task.root);
    if (payloadInput === undefined || !payloadInput.hasPayloadEnvelope()) {
      const exclude = new Set<PeerIdStr>();
      let admitted = false;
      for (let attempt = 0; attempt < FILL_TASK_ATTEMPTS_MAX && !admitted; attempt++) {
        if (deps.signal.aborted) return;
        const peer = selectAndReservePeer({
          kind: "envelopesByRoot",
          units: 1,
          ledger: deps.ledger,
          connected: deps.connectedPeers(),
          exclude,
        });
        if (peer === null) return; // quota-starved; events/scan re-drive

        try {
          const {result} = await fetchAndValidateExecutionPayloadEnvelopeByRoot({
            config,
            chain,
            network: deps.network,
            peerIdStr: peer,
            blockRoot: fromHex(task.root),
            blockRootHex: task.root,
            block: block as never,
            seenTimestampSec: Date.now() / 1000,
          });
          if (result === "ADMITTED") admitted = true;
          else if (result === "REJECTED") {
            deps.reportPeer(peer, "ENVELOPE_REJECTED");
            exclude.add(peer);
          } else {
            exclude.add(peer); // PEER_MISS / DEFERRED_NO_BUILDER — rotate, never score
          }
        } catch (e) {
          if (deps.signal.aborted) return;
          if (e instanceof RequestError) {
            parkIfRateLimited(deps.ledger, peer, e);
          }
          exclude.add(peer);
        } finally {
          deps.ledger.release(peer, "envelopesByRoot");
        }
      }
      if (!admitted) return;
      payloadInput = chain.seenPayloadEnvelopeInputCache.get(task.root);
    }
    if (payloadInput === undefined) return;

    // DA: data may still be missing — chain into a columns task that re-processes.
    if (!payloadInput.isComplete()) {
      this.submit({kind: "columns", root: task.root, input: payloadInput, inputKind: "payload"});
      return;
    }

    await this.processPayload(task.root, payloadInput);
  }

  // --- ColumnFill ------------------------------------------------------------

  private async fillColumns(task: {
    root: RootHex;
    input: IBlockInput | PayloadEnvelopeInput;
    inputKind: "block" | "payload";
  }): Promise<void> {
    const {deps} = this;
    const {chain} = deps;
    if (deps.signal.aborted) return;

    // Reuse the fill executor's single-item pass: partial accumulation across peers,
    // ledger-gated, admitting into the shared seen-cache inputs.
    if (task.inputKind === "payload") {
      const input = task.input as PayloadEnvelopeInput;
      if (!input.isComplete()) {
        const block = (await chain.getBlockByRoot(task.root).catch(() => null))?.block;
        if (block === undefined || block === null) return;
        await this.runSingleItemFill(task.root, block, /* needsEnvelope */ !input.hasPayloadEnvelope());
      }
      const refreshed = chain.seenPayloadEnvelopeInputCache.get(task.root);
      if (refreshed?.isComplete()) {
        await this.processPayload(task.root, refreshed);
      }
      return;
    }

    const input = task.input as IBlockInput;
    if (!input.hasBlockAndAllData()) {
      if (!input.hasBlock()) return; // nothing to key the column request on — gossip re-delivers
      await this.runSingleItemFill(task.root, input.getBlock(), false);
    }
    if (input.hasBlockAndAllData()) {
      try {
        await chain.processBlock(input, {ignoreIfKnown: true});
      } catch (e) {
        if (deps.signal.aborted) return;
        if (e instanceof BlockError) {
          // Parent-lineage faults route back to the target machinery with this
          // block as a waiter; everything else is the chain pipeline's business.
          this.deps.escalate(input.parentRootHex, {rootHex: task.root, peer: ""});
          this.deps.logger.debug("TargetSync column-fill block import deferred", {root: task.root, code: e.type.code});
        } else {
          throw e;
        }
      }
    }
  }

  /** One dataFill pass for a single root (columns + optionally the envelope). */
  private async runSingleItemFill(root: RootHex, block: SignedBeaconBlock, needsEnvelope: boolean): Promise<void> {
    const {deps} = this;
    const slot = block.message.slot;
    const forkName = deps.config.getForkName(slot);
    await dataFill([{root, slot, forkName, needsEnvelope, needsColumns: true, blobCount: 1}], {
      config: deps.config,
      chain: deps.chain,
      network: deps.network,
      // The input's block is in hand; dataFill's store read must find it.
      store: {get: async () => block},
      peers: new Set(deps.connectedPeers()),
      reportPeer: deps.reportPeer,
      ledger: deps.ledger,
    });
  }

  /** Import an admitted, DA-complete payload envelope (the canonical gate re-verifies). */
  private async processPayload(root: RootHex, payloadInput: PayloadEnvelopeInput): Promise<void> {
    const {deps} = this;
    try {
      await deps.chain.processExecutionPayload(payloadInput);
      deps.onPayloadProcessed(root);
      return;
    } catch (e) {
      if (deps.signal.aborted) return;
      if (e instanceof PayloadError) {
        const action = classifyPayloadImportError(e.type.code);
        if (action.action === "park" && action.reason === "awaitingBlock") {
          this.waitingForBlock.set(root, {escalations: 0});
        }
        // rejected: the serving peer already ate ENVELOPE_REJECTED at admission when
        // provable; block-state rejections here have no recorded server — drop (I13).
        // builderFault / transient: drop; events + scan re-drive.
        this.deps.logger.debug("TargetSync payload import deferred", {root, code: e.type.code});
      } else {
        throw e;
      }
    }
  }
}

function taskKey(task: FillTask): string {
  return `${task.kind}:${task.root}`;
}
