import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {Metrics} from "../../metrics/index.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import {ConsumerTarget, ConsumerTargetsMs, getConsumerTargetsMs} from "./consumerTargets.js";

/** Block critical-path milestones in pipeline order */
export enum BlockMilestone {
  /** Gossip admission from the message's `seenTimestampSec`: with the native network, admission after ingress */
  gossipAdmission,
  gossipValidationStart,
  gossipValidationEnd,
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
  /** Observed readiness: when the JS continuation ran, after an unknown execution client callback delay */
  getBlobsResponse,
  importStart,
  /** Observed readiness: when the JS continuation ran after the persistence queue had space */
  persistenceUnblock,
  forkChoice,
  head,
}

/** A synchronous segment of attestation batch work */
export enum AttestationSegment {
  /** A batch's first segment */
  start,
  /** A batch resuming after its signatures were verified */
  continuation,
  /** A batch resuming in a microtask of the segment before; timed in sampled slots, not counted */
  microtask,
}

type Input = {slot: Slot; blockRootHex: RootHex};

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
  [BlockMilestone.importStart]: "import_start",
  [BlockMilestone.persistenceUnblock]: "persistence_unblock",
  [BlockMilestone.forkChoice]: "fork_choice",
  [BlockMilestone.head]: "head",
};
/** Milestones stamped when the JS continuation ran after an external result, whose callback delay is unknown */
const OBSERVED_READINESS = [
  BlockMilestone.prestateReady,
  BlockMilestone.signaturesDone,
  BlockMilestone.executionDone,
  BlockMilestone.getBlobsResponse,
  BlockMilestone.persistenceUnblock,
];
const ATTESTATION_DATA = "attestation_data";
/** Every fork's head vote consumes the block, so each block milestone is measured against the attestation target */
const BLOCK_TARGET = ConsumerTarget.attestationDue;

/** Milestones every imported block records; the gossip ones only when it arrived by gossip */
const IMPORT_MILESTONES = [
  BlockMilestone.processorEnqueue,
  BlockMilestone.processorStart,
  BlockMilestone.prestateRequest,
  BlockMilestone.prestateReady,
  BlockMilestone.stateTransitionStart,
  BlockMilestone.stateTransitionEnd,
  BlockMilestone.signaturesDone,
  BlockMilestone.executionDone,
  BlockMilestone.dataAvailable,
  BlockMilestone.importStart,
  BlockMilestone.persistenceUnblock,
  BlockMilestone.forkChoice,
  BlockMilestone.head,
];
const GOSSIP_MILESTONES = [BlockMilestone.gossipValidationStart, BlockMilestone.gossipValidationEnd];

/** Critical-path stages between two milestones; a negative stage, e.g. data available before verification, is 0 */
const STAGES: {name: string; from: BlockMilestone; to: BlockMilestone}[] = [
  {name: "dispatch", from: BlockMilestone.gossipAdmission, to: BlockMilestone.gossipValidationStart},
  {name: "gossip_validation", from: BlockMilestone.gossipValidationStart, to: BlockMilestone.gossipValidationEnd},
  {name: "processor", from: BlockMilestone.processorEnqueue, to: BlockMilestone.processorStart},
  {name: "prestate", from: BlockMilestone.prestateRequest, to: BlockMilestone.prestateReady},
  {name: "state_transition", from: BlockMilestone.stateTransitionStart, to: BlockMilestone.stateTransitionEnd},
  {name: "signatures", from: BlockMilestone.stateTransitionEnd, to: BlockMilestone.signaturesDone},
  {name: "execution", from: BlockMilestone.prestateReady, to: BlockMilestone.executionDone},
  {name: "data_availability", from: BlockMilestone.prestateReady, to: BlockMilestone.dataAvailable},
  {name: "getblobs", from: BlockMilestone.getBlobsRequest, to: BlockMilestone.getBlobsResponse},
  {name: "persistence", from: BlockMilestone.importStart, to: BlockMilestone.persistenceUnblock},
  {name: "fork_choice", from: BlockMilestone.persistenceUnblock, to: BlockMilestone.forkChoice},
  {name: "head", from: BlockMilestone.forkChoice, to: BlockMilestone.head},
];
/** Verification branches that run in parallel, by the milestone that ends each */
const VERIFY_BRANCHES: {name: string; end: BlockMilestone}[] = [
  {name: "state_transition", end: BlockMilestone.stateTransitionEnd},
  {name: "signatures", end: BlockMilestone.signaturesDone},
  {name: "execution", end: BlockMilestone.executionDone},
  {name: "data_availability", end: BlockMilestone.dataAvailable},
];

/** Slots kept */
const RING_SLOTS = 128;
/** Competing roots traced per slot; more are counted as overflow */
const ROOTS_PER_SLOT = 4;
const ENTRIES = RING_SLOTS * ROOTS_PER_SLOT;
/** Disjoint runnable-import intervals kept per root */
const INTERVALS_PER_ROOT = 4;
/** Attestation segments kept to count retroactively, a power of two */
const ATTESTATION_LOG_SIZE = 16384;
const ATTESTATION_LOG_MASK = ATTESTATION_LOG_SIZE - 1;
/** Fields of a logged segment, adjacent in memory: start time, kind, duration */
const SEGMENT_FIELDS = 4;
const SAMPLE_EVERY_SLOTS = 8;
/** Slots before the clock slot that still take events; older slots are finalized */
const OPEN_PAST_SLOTS = 1;

/**
 * Whether attestation segments are timed in `slot`: one slot in SAMPLE_EVERY_SLOTS, at a position in the epoch that
 * moves by one each epoch so every position is sampled.
 */
export function isSampledSlot(slot: Slot): boolean {
  return (slot - Math.floor(slot / SLOTS_PER_EPOCH)) % SAMPLE_EVERY_SLOTS === 0;
}

/**
 * A bounded per-slot trace of each block's critical path, joined by slot and block root.
 *
 * Milestones are ms from the slot start: new ones are `performance.now()` stamps anchored to the slot start when the
 * slot's record is created, existing ones are Unix ms. Runnable-import intervals are when a stage's prerequisites and
 * serial lane were satisfied and it waited for the JS thread without running: the wait from native admission to
 * gossip validation, and the block processor's wait from enqueue, or from its lane freeing, to the job start. The
 * parallel verification branches expose no such interval to JS: their completions are observed readiness. Each root
 * keeps the union of its intervals, and counts the attestation segments that ran inside it from a log of segment starts.
 *
 * Storage is preallocated; recording a milestone allocates nothing. Metrics are observed when a slot is finalized,
 * `OPEN_PAST_SLOTS` after it ends.
 */
export class BlockTrace {
  /** Whether attestation segments are timed in the current slot, so callers can skip untimed segments */
  sampling = false;
  private readonly genesisMs: number;
  private readonly targets = new Map<ForkName, ConsumerTargetsMs>();
  private currentSlot: Slot;
  private currentIndex = -1;
  /** The current slot's attestation work, kept here to touch no slot array per segment */
  private currentStarts = 0;
  private currentContinuations = 0;
  private currentJsMs = 0;
  private processorIdleAt = 0;

  private readonly slotOf = new Float64Array(RING_SLOTS).fill(-1);
  private readonly slotStart = new Float64Array(RING_SLOTS);
  private readonly finalized = new Uint8Array(RING_SLOTS);
  private readonly rootCount = new Uint8Array(RING_SLOTS);
  private readonly rootsOverflow = new Uint32Array(RING_SLOTS);
  private readonly lastOverflowRoot: (RootHex | null)[] = new Array<RootHex | null>(RING_SLOTS).fill(null);
  private readonly slotStarts = new Uint32Array(RING_SLOTS);
  private readonly slotContinuations = new Uint32Array(RING_SLOTS);
  private readonly slotJsMs = new Float64Array(RING_SLOTS);
  private readonly attDataMs = new Float64Array(RING_SLOTS);
  private readonly attDataRoot: (RootHex | null)[] = new Array<RootHex | null>(RING_SLOTS).fill(null);
  private readonly attDataCount = new Uint32Array(RING_SLOTS);
  private readonly attDataRootChanged = new Uint8Array(RING_SLOTS);

  private readonly roots: (RootHex | null)[] = new Array<RootHex | null>(ENTRIES).fill(null);
  private readonly milestones = new Float64Array(ENTRIES * MILESTONE_COUNT);
  /** Disjoint `[begin, end]` pairs in `performance.now()` time */
  private readonly intervals = new Float64Array(ENTRIES * INTERVALS_PER_ROOT * 2);
  private readonly intervalCount = new Uint8Array(ENTRIES);
  private readonly intervalsDropped = new Uint8Array(ENTRIES);
  private readonly overlapStarts = new Uint32Array(ENTRIES);
  private readonly overlapContinuations = new Uint32Array(ENTRIES);
  private readonly overlapTimed = new Uint32Array(ENTRIES);
  private readonly overlapJsMs = new Float64Array(ENTRIES);
  private readonly overlapTruncated = new Uint8Array(ENTRIES);

  /** Each segment's `performance.now()` start, kind, and synchronous duration in ms when timed or NaN */
  private readonly segments = new Float64Array(ATTESTATION_LOG_SIZE * SEGMENT_FIELDS);
  private segmentHead = 0;
  private segmentsWritten = 0;

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

  /** Records `milestone` at `at`, a `performance.now()` time, unless the root recorded it already */
  mark(slot: Slot, root: RootHex, milestone: BlockMilestone, at = performance.now()): void {
    const e = this.entry(slot, root);
    if (e >= 0) this.setMilestone(e, milestone, at - this.slotStart[slotIndexOf(e)]);
  }

  markAll(inputs: readonly Input[], milestone: BlockMilestone, at = performance.now()): void {
    for (const {slot, blockRootHex} of inputs) this.mark(slot, blockRootHex, milestone, at);
  }

  /** Records `milestone` from an existing Unix timestamp in ms */
  markAllUnixMs(inputs: readonly Input[], milestone: BlockMilestone, unixMs: number): void {
    for (const {slot, blockRootHex} of inputs) {
      const e = this.entry(slot, blockRootHex);
      if (e >= 0) this.setMilestone(e, milestone, unixMs - this.slotStartMs(slot));
    }
  }

  /** Records native admission and the start of gossip validation at `at`; the wait between them was runnable */
  gossipValidationStart(slot: Slot, root: RootHex, seenTimestampSec: number, at: number): void {
    const e = this.entry(slot, root);
    if (e < 0) return;
    const start = this.slotStart[slotIndexOf(e)];
    const admitted = seenTimestampSec * 1000 - this.slotStartMs(slot);
    this.setMilestone(e, BlockMilestone.gossipAdmission, admitted);
    if (
      this.setMilestone(e, BlockMilestone.gossipValidationStart, at - start) &&
      !this.has(e, BlockMilestone.forkChoice)
    )
      this.addRunnable(e, start + admitted, at);
  }

  /**
   * Records a block processor job starting now. Its wait since `enqueuedAt`, or since the lane freed if later, was
   * runnable.
   */
  processorStart(inputs: readonly Input[], enqueuedAt: number): void {
    const now = performance.now();
    const begin = Math.max(enqueuedAt, this.processorIdleAt);
    for (const {slot, blockRootHex} of inputs) {
      const e = this.entry(slot, blockRootHex);
      if (e < 0) continue;
      this.setMilestone(e, BlockMilestone.processorStart, now - this.slotStart[slotIndexOf(e)]);
      this.addRunnable(e, begin, now);
    }
  }

  /** Records the block processor's lane freeing */
  processorIdle(): void {
    this.processorIdleAt = performance.now();
  }

  /** Records the head root the attestation data API selected for `slot` */
  attestationData(slot: Slot, root: RootHex): void {
    const s = this.slotIndex(slot);
    if (s < 0) return;
    if (this.attDataCount[s]++ === 0) {
      this.attDataMs[s] = performance.now() - this.slotStart[s];
      this.attDataRoot[s] = root;
    } else if (this.attDataRoot[s] !== root) {
      this.attDataRootChanged[s] = 1;
    }
  }

  /**
   * Logs the start of a synchronous attestation segment. Returns the handle `attestationSegmentEnd` takes when the
   * segment is timed, else -1.
   */
  attestationSegmentStart(kind: AttestationSegment): number {
    if (kind === AttestationSegment.microtask && !this.sampling) return -1;
    const i = this.segmentHead;
    const field = i * SEGMENT_FIELDS;
    this.segments[field] = performance.now();
    this.segments[field + 1] = kind;
    this.segments[field + 2] = NaN;
    this.segmentHead = (i + 1) & ATTESTATION_LOG_MASK;
    this.segmentsWritten++;
    if (kind === AttestationSegment.start) this.currentStarts++;
    else if (kind === AttestationSegment.continuation) this.currentContinuations++;
    return this.sampling ? i : -1;
  }

  attestationSegmentEnd(segment: number): void {
    if (segment < 0) return;
    const field = segment * SEGMENT_FIELDS;
    const duration = performance.now() - this.segments[field];
    this.segments[field + 2] = duration;
    this.currentJsMs += duration;
  }

  getSnapshot(): routes.lodestar.BlockTrace {
    const slots: routes.lodestar.BlockTraceSlot[] = [];
    for (let s = 0; s < RING_SLOTS; s++) if (this.slotOf[s] >= 0) slots.push(this.slotSnapshot(s));
    slots.sort((a, b) => a.slot - b.slot);
    return {
      currentSlot: this.currentSlot,
      slotDurationMs: this.config.SLOT_DURATION_MS,
      sampleEverySlots: SAMPLE_EVERY_SLOTS,
      milestones: Object.values(MILESTONE_NAMES),
      observedReadiness: OBSERVED_READINESS.map((m) => MILESTONE_NAMES[m]),
      slots,
    };
  }

  private readonly onClockSlot = (slot: Slot): void => {
    this.flushAttestationWork();
    this.currentSlot = slot;
    for (let s = 0; s < RING_SLOTS; s++) {
      if (this.slotOf[s] >= 0 && this.finalized[s] === 0 && this.slotOf[s] < slot - OPEN_PAST_SLOTS) {
        this.finalizeSlot(s);
      }
    }
    this.currentIndex = this.slotIndex(slot);
    this.sampling = isSampledSlot(slot);
  };

  private flushAttestationWork(): void {
    const s = this.currentIndex;
    if (s >= 0 && this.slotOf[s] === this.currentSlot) {
      this.slotStarts[s] += this.currentStarts;
      this.slotContinuations[s] += this.currentContinuations;
      this.slotJsMs[s] += this.currentJsMs;
    }
    this.currentStarts = 0;
    this.currentContinuations = 0;
    this.currentJsMs = 0;
  }

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
    if (held >= 0 && this.finalized[s] === 0) this.finalizeSlot(s);
    this.slotOf[s] = slot;
    this.slotStart[s] = performance.now() - (Date.now() - this.slotStartMs(slot));
    this.finalized[s] = 0;
    this.rootCount[s] = 0;
    this.rootsOverflow[s] = 0;
    this.lastOverflowRoot[s] = null;
    this.slotStarts[s] = 0;
    this.slotContinuations[s] = 0;
    this.slotJsMs[s] = 0;
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
    this.intervalCount[e] = 0;
    this.intervalsDropped[e] = 0;
    this.overlapStarts[e] = 0;
    this.overlapContinuations[e] = 0;
    this.overlapTimed[e] = 0;
    this.overlapJsMs[e] = 0;
    this.overlapTruncated[e] = 0;
    return e;
  }

  private has(e: number, milestone: BlockMilestone): boolean {
    return !Number.isNaN(this.milestones[e * MILESTONE_COUNT + milestone]);
  }

  /** Records the first value of a milestone; returns whether this call recorded it */
  private setMilestone(e: number, milestone: BlockMilestone, ms: number): boolean {
    const i = e * MILESTONE_COUNT + milestone;
    if (!Number.isNaN(this.milestones[i])) return false;
    this.milestones[i] = ms;
    return true;
  }

  /** Adds `[begin, end]` to the root's runnable-import union and counts the attestation work it newly covers */
  private addRunnable(e: number, begin: number, end: number): void {
    if (!(end > begin)) return;
    this.countAttestationWork(e, begin, end);

    const base = e * INTERVALS_PER_ROOT * 2;
    const count = this.intervalCount[e];
    let b = begin;
    let f = end;
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const ib = this.intervals[base + 2 * i];
      const ie = this.intervals[base + 2 * i + 1];
      if (ie < b || ib > f) {
        this.intervals[base + 2 * kept] = ib;
        this.intervals[base + 2 * kept + 1] = ie;
        kept++;
      } else {
        b = Math.min(b, ib);
        f = Math.max(f, ie);
      }
    }
    if (kept === INTERVALS_PER_ROOT) {
      this.intervalsDropped[e] = 1;
      return;
    }
    this.intervals[base + 2 * kept] = b;
    this.intervals[base + 2 * kept + 1] = f;
    this.intervalCount[e] = kept + 1;
  }

  private covered(e: number, t: number): boolean {
    const base = e * INTERVALS_PER_ROOT * 2;
    for (let i = 0; i < this.intervalCount[e]; i++) {
      if (t >= this.intervals[base + 2 * i] && t <= this.intervals[base + 2 * i + 1]) return true;
    }
    return false;
  }

  /** Counts logged attestation segments that started in `[begin, end]` outside the root's union so far */
  private countAttestationWork(e: number, begin: number, end: number): void {
    const logged = Math.min(this.segmentsWritten, ATTESTATION_LOG_SIZE);
    let i = this.segmentHead;
    let scanned = 0;
    for (; scanned < logged; scanned++) {
      i = (i - 1) & ATTESTATION_LOG_MASK;
      const t = this.segments[i * SEGMENT_FIELDS];
      const duration = this.segments[i * SEGMENT_FIELDS + 2];
      if (t < begin) {
        // A timed segment that straddles `begin` contributes its part inside
        if (!Number.isNaN(duration) && t + duration > begin && !this.covered(e, begin)) {
          this.overlapJsMs[e] += Math.min(t + duration, end) - begin;
        }
        break;
      }
      if (t > end || this.covered(e, t)) continue;
      const kind = this.segments[i * SEGMENT_FIELDS + 1];
      if (kind === AttestationSegment.start) this.overlapStarts[e]++;
      else if (kind === AttestationSegment.continuation) this.overlapContinuations[e]++;
      if (!Number.isNaN(duration)) {
        this.overlapTimed[e]++;
        this.overlapJsMs[e] += Math.min(duration, end - t);
      }
    }
    if (scanned === logged && this.segmentsWritten > ATTESTATION_LOG_SIZE) this.overlapTruncated[e] = 1;
  }

  private runnableMs(e: number): number {
    const base = e * INTERVALS_PER_ROOT * 2;
    let ms = 0;
    for (let i = 0; i < this.intervalCount[e]; i++)
      ms += this.intervals[base + 2 * i + 1] - this.intervals[base + 2 * i];
    return ms;
  }

  private finalizeSlot(s: number): void {
    this.finalized[s] = 1;
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
      if (!this.has(e, BlockMilestone.forkChoice)) {
        metrics.blocks.inc({outcome: "not_imported"});
        continue;
      }
      metrics.blocks.inc({outcome: this.has(e, BlockMilestone.head) ? "head" : "imported"});

      const offset = e * MILESTONE_COUNT;
      for (let m = 0; m < MILESTONE_COUNT; m++) {
        const ms = this.milestones[offset + m];
        if (Number.isNaN(ms)) continue;
        const milestone = MILESTONE_NAMES[m as BlockMilestone];
        metrics.milestone.observe({milestone}, ms / 1000);
        metrics.milestoneToTarget.observe({milestone, target: BLOCK_TARGET}, (ms - due) / 1000);
        if (ms > due) metrics.milestoneLate.inc({milestone});
      }
      for (const m of IMPORT_MILESTONES) {
        if (!this.has(e, m)) metrics.milestoneMissing.inc({milestone: MILESTONE_NAMES[m]});
      }
      if (this.has(e, BlockMilestone.gossipAdmission)) {
        for (const m of GOSSIP_MILESTONES) {
          if (!this.has(e, m)) metrics.milestoneMissing.inc({milestone: MILESTONE_NAMES[m]});
        }
      }
      for (const {name, from, to} of STAGES) {
        const ms = this.milestones[offset + to] - this.milestones[offset + from];
        if (!Number.isNaN(ms)) metrics.stage.observe({stage: name}, Math.max(0, ms) / 1000);
      }
      let lastBranch: string | null = null;
      let lastEnd = -Infinity;
      for (const {name, end} of VERIFY_BRANCHES) {
        const ms = this.milestones[offset + end];
        if (Number.isNaN(ms)) {
          lastBranch = null;
          break;
        }
        if (ms > lastEnd) {
          lastEnd = ms;
          lastBranch = name;
        }
      }
      if (lastBranch !== null) metrics.verifyLast.inc({branch: lastBranch});

      metrics.runnableImport.observe(this.runnableMs(e) / 1000);
      metrics.runnableImportAttestationSegments.observe({kind: "start"}, this.overlapStarts[e]);
      metrics.runnableImportAttestationSegments.observe({kind: "continuation"}, this.overlapContinuations[e]);
      if (isSampledSlot(slot)) metrics.runnableImportAttestationJs.observe(this.overlapJsMs[e] / 1000);
      if (this.overlapTruncated[e]) metrics.attestationLogTruncated.inc();
    }
  }

  private outcome(e: number, finalized: boolean): routes.lodestar.BlockTraceRoot["outcome"] {
    if (this.has(e, BlockMilestone.head)) return "head";
    if (this.has(e, BlockMilestone.forkChoice)) return "imported";
    return finalized ? "not_imported" : "pending";
  }

  private slotSnapshot(s: number): routes.lodestar.BlockTraceSlot {
    const slot = this.slotOf[s];
    const start = this.slotStart[s];
    const finalized = this.finalized[s] === 1;
    const sampled = isSampledSlot(slot);
    const current = s === this.currentIndex && slot === this.currentSlot;
    const roots: routes.lodestar.BlockTraceRoot[] = [];
    const first = s * ROOTS_PER_SLOT;
    for (let e = first; e < first + this.rootCount[s]; e++) {
      const milestones: Record<string, number> = {};
      for (let m = 0; m < MILESTONE_COUNT; m++) {
        const ms = this.milestones[e * MILESTONE_COUNT + m];
        if (!Number.isNaN(ms)) milestones[MILESTONE_NAMES[m as BlockMilestone]] = round(ms);
      }
      const intervals: [number, number][] = [];
      const base = e * INTERVALS_PER_ROOT * 2;
      for (let i = 0; i < this.intervalCount[e]; i++) {
        intervals.push([round(this.intervals[base + 2 * i] - start), round(this.intervals[base + 2 * i + 1] - start)]);
      }
      intervals.sort((a, b) => a[0] - b[0]);
      roots.push({
        root: this.roots[e] as RootHex,
        outcome: this.outcome(e, finalized),
        milestones,
        runnableImport: {
          ms: round(this.runnableMs(e)),
          intervals,
          intervalsDropped: this.intervalsDropped[e] === 1,
          attestationStarts: this.overlapStarts[e],
          attestationContinuations: this.overlapContinuations[e],
          attestationTimedSegments: this.overlapTimed[e],
          attestationJsMs: round(this.overlapJsMs[e]),
          attestationLogTruncated: this.overlapTruncated[e] === 1,
        },
      });
    }
    const attDataRoot = this.attDataRoot[s];
    return {
      slot,
      fork: this.config.getForkName(slot),
      finalized,
      sampled,
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
      attestationWork: {
        starts: this.slotStarts[s] + (current ? this.currentStarts : 0),
        continuations: this.slotContinuations[s] + (current ? this.currentContinuations : 0),
        jsMs: sampled ? round(this.slotJsMs[s] + (current ? this.currentJsMs : 0)) : null,
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
