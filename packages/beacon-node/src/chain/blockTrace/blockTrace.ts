import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import type {DataAvailableVia, IBlockInput} from "../blocks/blockInput/types.js";
import {ConsumerTarget, ConsumerTargetsMs, getConsumerTargetsMs} from "./consumerTargets.js";

/** Block critical-path milestones in pipeline order */
export enum BlockMilestone {
  /** Gossip admission from the message's `seenTimestampSec`: with the native network, admission after ingress */
  gossipAdmission,
  gossipValidationStart,
  /** Validation ended, whatever its result */
  gossipValidationEnd,
  /** A root's first block processor enqueue */
  processorEnqueue,
  processorStart,
  prestateRequest,
  /** Observed readiness: when the JS continuation ran, after regen's queue and any state load */
  prestateReady,
  stateTransitionStart,
  stateTransitionEnd,
  /** Observed readiness: when the JS continuation ran, after an unknown worker callback delay */
  signaturesDone,
  /** Observed readiness: when the JS continuation ran, after an unknown execution client callback delay */
  executionDone,
  /** When all sampled columns, or enough to reconstruct, first became available */
  dataAvailable,
  getBlobsRequest,
  /** Observed readiness: the first getBlobs call's end, after an unknown execution client callback delay */
  getBlobsResponse,
  /** Import reached the persistence queue */
  persistenceRequest,
  /** Observed readiness: when the JS continuation ran after the persistence queue had space */
  persistenceUnblock,
  forkChoice,
  /** First became head */
  head,
}

/**
 * Waits that proxy runnable import work. Neither establishes that the block was eligible to run: native execution
 * capacity can hold a block while JS is free, and the processor wait includes the queue's deliberate yield.
 */
export enum BlockWait {
  /** From gossip admission to the gossip handler */
  dispatch,
  /** From a processor job's enqueue, or the lane freeing if later, to its start */
  processor,
}

/** A block processor job's attempt at its blocks; its marks are dropped once a later attempt at the block starts */
export type BlockAttempt = {
  /** Records `milestone` for every block at `at`, a `performance.now()` time */
  mark(milestone: BlockMilestone, at?: number): void;
  /** Records `milestone` for every block from an existing Unix timestamp in ms */
  markUnixMs(milestone: BlockMilestone, unixMs: number): void;
  markBlock(root: RootHex, milestone: BlockMilestone): void;
};

const MILESTONE_COUNT = BlockMilestone.head + 1;
const MILESTONE_NAMES: Record<BlockMilestone, string> = {
  [BlockMilestone.gossipAdmission]: "gossip_admission",
  [BlockMilestone.gossipValidationStart]: "gossip_validation_start",
  [BlockMilestone.gossipValidationEnd]: "gossip_validation_end",
  [BlockMilestone.processorEnqueue]: "processor_enqueue",
  [BlockMilestone.processorStart]: "processor_start",
  [BlockMilestone.prestateRequest]: "prestate_request",
  [BlockMilestone.prestateReady]: "prestate_ready",
  [BlockMilestone.stateTransitionStart]: "state_transition_start",
  [BlockMilestone.stateTransitionEnd]: "state_transition_end",
  [BlockMilestone.signaturesDone]: "signatures_done",
  [BlockMilestone.executionDone]: "execution_done",
  [BlockMilestone.dataAvailable]: "data_available",
  [BlockMilestone.getBlobsRequest]: "getblobs_request",
  [BlockMilestone.getBlobsResponse]: "getblobs_response",
  [BlockMilestone.persistenceRequest]: "persistence_request",
  [BlockMilestone.persistenceUnblock]: "persistence_unblock",
  [BlockMilestone.forkChoice]: "fork_choice",
  [BlockMilestone.head]: "head",
};
const OBSERVED_READINESS = [
  BlockMilestone.prestateReady,
  BlockMilestone.signaturesDone,
  BlockMilestone.executionDone,
  BlockMilestone.getBlobsResponse,
  BlockMilestone.persistenceUnblock,
];
/** Milestones of a processing attempt, cleared when a later attempt starts; the others keep their first value */
const ATTEMPT_MILESTONES = [
  BlockMilestone.processorStart,
  BlockMilestone.prestateRequest,
  BlockMilestone.prestateReady,
  BlockMilestone.stateTransitionStart,
  BlockMilestone.stateTransitionEnd,
  BlockMilestone.signaturesDone,
  BlockMilestone.executionDone,
  BlockMilestone.persistenceRequest,
  BlockMilestone.persistenceUnblock,
];
/** Milestones an imported block records; the gossip ones only when it arrived by gossip */
const EXPECTED_MILESTONES = [
  BlockMilestone.processorEnqueue,
  ...ATTEMPT_MILESTONES,
  BlockMilestone.dataAvailable,
  BlockMilestone.forkChoice,
  BlockMilestone.head,
];
const GOSSIP_MILESTONES = [BlockMilestone.gossipValidationStart, BlockMilestone.gossipValidationEnd];
const WAIT_COUNT = BlockWait.processor + 1;
const WAIT_NAMES: Record<BlockWait, "dispatch" | "processor"> = {
  [BlockWait.dispatch]: "dispatch",
  [BlockWait.processor]: "processor",
};
const ATTESTATION_DATA = "attestation_data";
/** Every fork's head vote consumes the block, so each block milestone is measured against the attestation target */
const BLOCK_TARGET = ConsumerTarget.attestationDue;

const RING_SLOTS = 128;
/** Competing roots traced per slot; more are counted as overflow */
const ROOTS_PER_SLOT = 4;
const ENTRIES = RING_SLOTS * ROOTS_PER_SLOT;
/** Slots before the clock slot that still take events; older slots are closed */
const OPEN_PAST_SLOTS = 1;

/**
 * A bounded per-slot trace of each block's critical path, joined by slot and block root.
 *
 * Milestones are ms from the slot start: new ones are `performance.now()` stamps anchored to the slot start when the
 * slot's record is created, existing ones are Unix ms. A root keeps its first arrival milestones and its latest
 * processing attempt; an imported root takes no further attempts. Each root records its dispatch and processor waits,
 * which proxy runnable import work.
 *
 * Storage is preallocated; recording a milestone allocates nothing. A slot closes at the start of slot + 2, when its
 * metrics are observed: "not imported" and "never head" mean by then.
 */
export class BlockTrace {
  private readonly genesisMs: number;
  private readonly targets = new Map<ForkName, ConsumerTargetsMs>();
  private currentSlot: Slot;
  private laneFreeAt = 0;
  private generations = 0;

  private readonly slotOf = new Float64Array(RING_SLOTS).fill(-1);
  private readonly slotStart = new Float64Array(RING_SLOTS);
  private readonly closed = new Uint8Array(RING_SLOTS);
  private readonly rootCount = new Uint8Array(RING_SLOTS);
  private readonly rootsOverflow = new Uint32Array(RING_SLOTS);
  private readonly lastOverflowRoot: (RootHex | null)[] = new Array<RootHex | null>(RING_SLOTS).fill(null);
  private readonly attDataMs = new Float64Array(RING_SLOTS);
  private readonly attDataRoot: (RootHex | null)[] = new Array<RootHex | null>(RING_SLOTS).fill(null);
  private readonly attDataCount = new Uint32Array(RING_SLOTS);
  private readonly attDataRootChanged = new Uint8Array(RING_SLOTS);

  private readonly roots: (RootHex | null)[] = new Array<RootHex | null>(ENTRIES).fill(null);
  private readonly milestones = new Float64Array(ENTRIES * MILESTONE_COUNT);
  /** The generation of each root's latest attempt, unique across roots */
  private readonly generation = new Float64Array(ENTRIES);
  private readonly attempts = new Uint16Array(ENTRIES);
  /** What first completed each root's data, null when not recorded */
  private readonly dataAvailableVia: (DataAvailableVia | null)[] = new Array<DataAvailableVia | null>(ENTRIES).fill(
    null
  );
  /** Per root and wait: `performance.now()` begin and end, NaN when not recorded */
  private readonly waitBegin = new Float64Array(ENTRIES * WAIT_COUNT);
  private readonly waitEnd = new Float64Array(ENTRIES * WAIT_COUNT);

  constructor(
    private readonly config: ChainForkConfig,
    clock: IClock,
    private readonly metrics: Metrics | null
  ) {
    this.genesisMs = clock.genesisTime * 1000;
    this.currentSlot = clock.currentSlot;
    this.onClockSlot(this.currentSlot);
    clock.on(ClockEvent.slot, this.onClockSlot);
  }

  /** Records an arrival milestone at `at`, a `performance.now()` time, unless the root recorded it already */
  mark(slot: Slot, root: RootHex, milestone: BlockMilestone, at = performance.now()): void {
    const e = this.entry(slot, root);
    if (e >= 0) this.setMilestone(e, milestone, at - this.slotStart[slotIndexOf(e)]);
  }

  /** Records the block input's data availability and what completed it when it happens, or now if it has */
  observeDataAvailable(block: IBlockInput): void {
    const {slot, blockRootHex} = block;
    block.observeDataAvailable((at, via) => {
      const e = this.entry(slot, blockRootHex);
      if (e >= 0 && this.setMilestone(e, BlockMilestone.dataAvailable, at - this.slotStart[slotIndexOf(e)])) {
        this.dataAvailableVia[e] = via;
      }
    });
  }

  /** Records a block processor job's enqueue at `at`, a `performance.now()` time */
  enqueued(blocks: readonly IBlockInput[], at: number): void {
    for (const block of blocks) {
      this.mark(block.slot, block.blockRootHex, BlockMilestone.processorEnqueue, at);
      this.observeDataAvailable(block);
    }
  }

  /** Records gossip admission and the start of gossip validation at `at`, with the dispatch wait between them */
  gossipValidationStart(slot: Slot, root: RootHex, seenTimestampSec: number, at: number): void {
    const e = this.entry(slot, root);
    if (e < 0) return;
    const admitted = seenTimestampSec * 1000 - this.slotStartMs(slot);
    this.setMilestone(e, BlockMilestone.gossipAdmission, admitted);
    const start = this.slotStart[slotIndexOf(e)];
    if (
      this.setMilestone(e, BlockMilestone.gossipValidationStart, at - start) &&
      !this.has(e, BlockMilestone.forkChoice)
    ) {
      this.setWait(e, BlockWait.dispatch, start + admitted, at);
    }
  }

  /** Records whether this is the root's first getBlobs call, whose response is recorded */
  getBlobsRequest(slot: Slot, root: RootHex): boolean {
    const e = this.entry(slot, root);
    return (
      e >= 0 && this.setMilestone(e, BlockMilestone.getBlobsRequest, performance.now() - this.slotStart[slotIndexOf(e)])
    );
  }

  /**
   * Starts a block processor job's attempt at its blocks now, clearing each block's previous attempt. A block already
   * imported takes no attempt. Returns null when no block is traced.
   */
  startAttempt(blocks: readonly IBlockInput[], enqueuedAt: number): BlockAttempt | null {
    const now = performance.now();
    const waitFrom = Math.max(enqueuedAt, this.laneFreeAt);
    const entries: number[] = [];
    const generations: number[] = [];
    for (const block of blocks) {
      const e = this.entry(block.slot, block.blockRootHex);
      if (e < 0 || this.has(e, BlockMilestone.forkChoice)) continue;
      const generation = ++this.generations;
      this.generation[e] = generation;
      this.attempts[e]++;
      for (const m of ATTEMPT_MILESTONES) this.milestones[e * MILESTONE_COUNT + m] = NaN;
      this.setMilestone(e, BlockMilestone.processorStart, now - this.slotStart[slotIndexOf(e)]);
      this.setWait(e, BlockWait.processor, waitFrom, now);
      entries.push(e);
      generations.push(generation);
    }
    if (entries.length === 0) return null;

    const markEntry = (i: number, milestone: BlockMilestone, at: number, unix: boolean): void => {
      const e = entries[i];
      const s = slotIndexOf(e);
      if (this.generation[e] !== generations[i] || this.closed[s] === 1) return;
      this.setMilestone(e, milestone, unix ? at - this.slotStartMs(this.slotOf[s]) : at - this.slotStart[s]);
    };
    return {
      mark: (milestone, at = performance.now()) => {
        for (let i = 0; i < entries.length; i++) markEntry(i, milestone, at, false);
      },
      markUnixMs: (milestone, unixMs) => {
        for (let i = 0; i < entries.length; i++) markEntry(i, milestone, unixMs, true);
      },
      markBlock: (root, milestone) => {
        const at = performance.now();
        for (let i = 0; i < entries.length; i++)
          if (this.roots[entries[i]] === root) markEntry(i, milestone, at, false);
      },
    };
  }

  /** Records the block processor's lane freeing, before the queue's optional yield */
  processorLaneFree(): void {
    this.laneFreeAt = performance.now();
  }

  /** Records the head root the attestation data API returned for `slot`, selected at `selectedAt` */
  attestationData(slot: Slot, root: RootHex, selectedAt: number): void {
    const s = this.slotIndex(slot);
    if (s < 0) return;
    if (this.attDataCount[s]++ === 0) {
      this.attDataMs[s] = selectedAt - this.slotStart[s];
      this.attDataRoot[s] = root;
    } else if (this.attDataRoot[s] !== root) {
      this.attDataRootChanged[s] = 1;
    }
  }

  getSnapshot(): routes.lodestar.BlockTrace {
    const slots: routes.lodestar.BlockTraceSlot[] = [];
    for (let s = 0; s < RING_SLOTS; s++) if (this.slotOf[s] >= 0) slots.push(this.slotSnapshot(s));
    slots.sort((a, b) => a.slot - b.slot);
    return {
      currentSlot: this.currentSlot,
      slotDurationMs: this.config.SLOT_DURATION_MS,
      milestoneNames: Object.values(MILESTONE_NAMES),
      observedReadiness: OBSERVED_READINESS.map((m) => MILESTONE_NAMES[m]),
      slots,
    };
  }

  private readonly onClockSlot = (slot: Slot): void => {
    this.currentSlot = slot;
    for (let s = 0; s < RING_SLOTS; s++) {
      if (this.slotOf[s] >= 0 && this.closed[s] === 0 && this.slotOf[s] < slot - OPEN_PAST_SLOTS) this.closeSlot(s);
    }
    this.slotIndex(slot);
  };

  private slotStartMs(slot: Slot): number {
    return this.genesisMs + slot * this.config.SLOT_DURATION_MS;
  }

  private getTargets(slot: Slot): ConsumerTargetsMs {
    const fork = this.config.getForkName(slot);
    let targets = this.targets.get(fork);
    if (targets === undefined) {
      targets = getConsumerTargetsMs(this.config, fork);
      this.targets.set(fork, targets);
    }
    return targets;
  }

  /** The ring index of an open slot's record, created on first use; -1 outside the open window */
  private slotIndex(slot: Slot): number {
    if (slot < this.currentSlot - OPEN_PAST_SLOTS || slot > this.currentSlot + 1) return -1;
    const s = slot % RING_SLOTS;
    const held = this.slotOf[s];
    if (held === slot) return s;
    if (held >= 0 && this.closed[s] === 0) this.closeSlot(s);
    this.slotOf[s] = slot;
    this.slotStart[s] = performance.now() - (Date.now() - this.slotStartMs(slot));
    this.closed[s] = 0;
    this.rootCount[s] = 0;
    this.rootsOverflow[s] = 0;
    this.lastOverflowRoot[s] = null;
    this.attDataMs[s] = NaN;
    this.attDataRoot[s] = null;
    this.attDataCount[s] = 0;
    this.attDataRootChanged[s] = 0;
    this.roots.fill(null, s * ROOTS_PER_SLOT, (s + 1) * ROOTS_PER_SLOT);
    return s;
  }

  /** The entry of `root` in an open slot, created on first use; -1 when untraced */
  private entry(slot: Slot, root: RootHex): number {
    const s = this.slotIndex(slot);
    if (s < 0) return -1;
    const first = s * ROOTS_PER_SLOT;
    const count = this.rootCount[s];
    for (let e = first; e < first + count; e++) if (this.roots[e] === root) return e;
    if (count === ROOTS_PER_SLOT) {
      // Counts changes of overflowing root, not distinct roots
      if (this.lastOverflowRoot[s] !== root) {
        this.lastOverflowRoot[s] = root;
        this.rootsOverflow[s]++;
        this.metrics?.blockTrace.rootsOverflow.inc();
      }
      return -1;
    }
    const e = first + count;
    this.rootCount[s] = count + 1;
    this.roots[e] = root;
    this.milestones.fill(NaN, e * MILESTONE_COUNT, (e + 1) * MILESTONE_COUNT);
    this.generation[e] = ++this.generations;
    this.attempts[e] = 0;
    this.dataAvailableVia[e] = null;
    this.waitBegin.fill(NaN, e * WAIT_COUNT, (e + 1) * WAIT_COUNT);
    this.waitEnd.fill(NaN, e * WAIT_COUNT, (e + 1) * WAIT_COUNT);
    return e;
  }

  private has(e: number, milestone: BlockMilestone): boolean {
    return !Number.isNaN(this.milestones[e * MILESTONE_COUNT + milestone]);
  }

  /** Records a milestone unless it has a value; returns whether this call recorded it */
  private setMilestone(e: number, milestone: BlockMilestone, ms: number): boolean {
    const i = e * MILESTONE_COUNT + milestone;
    if (!Number.isNaN(this.milestones[i])) return false;
    this.milestones[i] = ms;
    return true;
  }

  /** Records the wait `[begin, end]` */
  private setWait(e: number, wait: BlockWait, begin: number, end: number): void {
    const w = e * WAIT_COUNT + wait;
    this.waitBegin[w] = begin;
    this.waitEnd[w] = Math.max(begin, end);
  }

  private outcome(e: number): "head" | "imported" | "not_imported" {
    if (this.has(e, BlockMilestone.head)) return "head";
    return this.has(e, BlockMilestone.forkChoice) ? "imported" : "not_imported";
  }

  private closeSlot(s: number): void {
    this.closed[s] = 1;
    const metrics = this.metrics?.blockTrace;
    if (!metrics) return;
    const slot = this.slotOf[s];
    const due = this.getTargets(slot)[BLOCK_TARGET] ?? 0;
    const first = s * ROOTS_PER_SLOT;
    const last = first + this.rootCount[s];

    if (this.attDataCount[s] > 0) {
      const ms = this.attDataMs[s];
      metrics.milestone.observe({milestone: ATTESTATION_DATA}, ms / 1000);
      metrics.milestoneToTarget.observe({milestone: ATTESTATION_DATA, target: BLOCK_TARGET}, (ms - due) / 1000);
      if (ms > due) metrics.milestoneLate.inc({milestone: ATTESTATION_DATA});
      let selected = last > first ? "other_root" : "no_block";
      for (let e = first; e < last; e++) if (this.roots[e] === this.attDataRoot[s]) selected = "slot_block";
      metrics.attestationData.inc({selected});
    }

    for (let e = first; e < last; e++) {
      const outcome = this.outcome(e);
      metrics.blocks.inc({outcome});
      const offset = e * MILESTONE_COUNT;
      for (let m = 0; m < MILESTONE_COUNT; m++) {
        const ms = this.milestones[offset + m];
        if (Number.isNaN(ms)) continue;
        const milestone = MILESTONE_NAMES[m as BlockMilestone];
        metrics.milestone.observe({milestone}, ms / 1000);
        metrics.milestoneToTarget.observe({milestone, target: BLOCK_TARGET}, (ms - due) / 1000);
        if (ms > due) metrics.milestoneLate.inc({milestone});
      }
      for (const m of EXPECTED_MILESTONES) {
        if (!this.has(e, m)) metrics.milestoneMissing.inc({milestone: MILESTONE_NAMES[m], outcome});
      }
      if (this.has(e, BlockMilestone.gossipAdmission)) {
        for (const m of GOSSIP_MILESTONES) {
          if (!this.has(e, m)) metrics.milestoneMissing.inc({milestone: MILESTONE_NAMES[m], outcome});
        }
      }
      const persistence =
        this.milestones[offset + BlockMilestone.persistenceUnblock] -
        this.milestones[offset + BlockMilestone.persistenceRequest];
      if (!Number.isNaN(persistence)) metrics.wait.observe({wait: "persistence"}, Math.max(0, persistence) / 1000);
      const via = this.dataAvailableVia[e];
      if (via !== null) {
        metrics.dataAvailable.inc({
          source: via.source,
          completion: via.reconstructable ? "reconstructable" : "complete",
        });
      }

      for (let wait = 0; wait < WAIT_COUNT; wait++) {
        const w = e * WAIT_COUNT + wait;
        if (Number.isNaN(this.waitBegin[w])) continue;
        metrics.wait.observe({wait: WAIT_NAMES[wait as BlockWait]}, (this.waitEnd[w] - this.waitBegin[w]) / 1000);
      }
    }
  }

  private waitSnapshot(e: number, wait: BlockWait, start: number): routes.lodestar.BlockTraceWait | null {
    const w = e * WAIT_COUNT + wait;
    if (Number.isNaN(this.waitBegin[w])) return null;
    return {beginMs: round(this.waitBegin[w] - start), endMs: round(this.waitEnd[w] - start)};
  }

  private slotSnapshot(s: number): routes.lodestar.BlockTraceSlot {
    const slot = this.slotOf[s];
    const start = this.slotStart[s];
    const roots: routes.lodestar.BlockTraceRoot[] = [];
    const first = s * ROOTS_PER_SLOT;
    for (let e = first; e < first + this.rootCount[s]; e++) {
      const milestones: (number | null)[] = [];
      for (let m = 0; m < MILESTONE_COUNT; m++) {
        const ms = this.milestones[e * MILESTONE_COUNT + m];
        milestones.push(Number.isNaN(ms) ? null : round(ms));
      }
      const outcome = this.outcome(e);
      roots.push({
        root: this.roots[e] as RootHex,
        outcome: outcome === "not_imported" && this.closed[s] === 0 ? "pending" : outcome,
        attempts: this.attempts[e],
        milestones,
        dataAvailableVia: this.dataAvailableVia[e],
        waits: {
          dispatch: this.waitSnapshot(e, BlockWait.dispatch, start),
          processor: this.waitSnapshot(e, BlockWait.processor, start),
        },
      });
    }
    const attDataRoot = this.attDataRoot[s];
    return {
      slot,
      fork: this.config.getForkName(slot),
      closed: this.closed[s] === 1,
      targetsMs: this.getTargets(slot),
      attestationData:
        attDataRoot === null
          ? null
          : {
              ms: round(this.attDataMs[s]),
              root: attDataRoot,
              count: this.attDataCount[s],
              rootChanged: this.attDataRootChanged[s] === 1,
            },
      rootsOverflow: this.rootsOverflow[s],
      roots,
    };
  }
}

function slotIndexOf(entry: number): number {
  return Math.floor(entry / ROOTS_PER_SLOT);
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}
