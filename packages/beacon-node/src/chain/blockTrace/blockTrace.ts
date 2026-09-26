import {routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex, Slot} from "@lodestar/types";
import {HttpRequestTimes} from "../../execution/engine/jsonRpcHttpClient.js";
import {Metrics} from "../../metrics/index.js";
import {ClockEvent, IClock} from "../../util/clock.js";
import type {CellComputeTimes} from "../../util/dataColumns.js";
import type {DataAvailableVia, IBlockInput} from "../blocks/blockInput/types.js";
import {DispatchArm, DispatchGateResult, pastDeadlineMs} from "../blocks/dispatchGate.js";
import {BlsJobTimes} from "../bls/interface.js";
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
  /**
   * The block's signature sets were built, just before submission to the BLS verifier. When the pool splits them into
   * several jobs, each later stage is the latest job's.
   */
  signatureSetsBuilt,
  /** The BLS pool picked the block's job for a worker dispatch */
  signatureJobSelected,
  /** The dispatch's work requests were prepared, before posting them to the worker */
  signatureJobPrepared,
  /** The worker started the dispatch carrying the job, as the worker stamped it; the dispatch includes other jobs */
  signatureWorkerStart,
  /** The worker finished that whole dispatch, as the worker stamped it; the dispatch's results return together */
  signatureWorkerEnd,
  /** Observed readiness: when the dispatch's result reached JS */
  signatureReceipt,
  /** Observed readiness: when the JS continuation ran, after an unknown worker callback delay */
  signaturesDone,
  /**
   * The newPayload request's first attempt handed its body to the execution client connection, not confirmed delivered;
   * a retry or a followed redirect never moves it
   */
  executionFirstSent,
  /**
   * The newPayload request's body was handed to the execution client connection, not confirmed delivered. With retries
   * it is the latest attempt's, so the time before it can include earlier failures and backoff; unset when a redirect was
   * followed.
   */
  executionDispatch,
  /** Observed readiness: when the latest attempt's newPayload response headers reached JS */
  executionReceipt,
  /** Observed readiness: when the JS continuation ran, after an unknown execution client callback delay */
  executionDone,
  /** When all sampled columns, or enough to reconstruct, first became available */
  dataAvailable,
  getBlobsRequest,
  /** The first getBlobs call's first attempt handed its engine request body to the connection, as for newPayload */
  getBlobsFirstSent,
  /** The first getBlobs call's engine request body was handed to the connection, with retries as for newPayload */
  getBlobsDispatch,
  /** Observed readiness: when the first getBlobs call's latest response headers reached JS */
  getBlobsReceipt,
  /** Observed readiness: the first getBlobs call's end, after an unknown execution client callback delay */
  getBlobsResponse,
  /**
   * Observed readiness: the first getBlobs call's cells were computed and sidecars assembled, when it could satisfy
   * availability
   */
  getBlobsUsable,
  /** Import reached the persistence queue */
  persistenceRequest,
  /** Observed readiness: when the JS continuation ran after the persistence queue had space */
  persistenceUnblock,
  forkChoice,
  /** First became head */
  head,
}

/**
 * Waits of a block's import work. The dispatch and processor waits proxy runnable work without establishing that the
 * block was eligible to run: native execution capacity can hold a block while JS is free, and the processor wait
 * includes the queue's deliberate yield.
 */
export enum BlockWait {
  /** From gossip admission to the gossip handler */
  dispatch,
  /** From a processor job's enqueue, or the lane freeing if later, to its start */
  processor,
  /** The treatment's wait before the state transition for its engine request writes */
  dispatchGate,
  /**
   * From the worker's end of the dispatch carrying the attempt's signature job to its result reaching JS, which includes
   * message transport and the main thread's other work
   */
  signatureReturn,
}

/** A synchronous segment of gossip attestation batch work */
enum AttestationSegment {
  /** A batch's first segment */
  start,
  /** A batch resuming after its signatures were verified */
  continuation,
  /** A batch resuming in a microtask of its previous segment; logged only in sampled slots, not counted */
  microtask,
}

/** A block processor job's attempt at its blocks; its marks are dropped once a later attempt at the block starts */
export type BlockAttempt = {
  /** Records `milestone` for every block at `at`, a `performance.now()` time */
  mark(milestone: BlockMilestone, at?: number): void;
  /** Records `milestone` for every block from an existing Unix timestamp in ms */
  markUnixMs(milestone: BlockMilestone, unixMs: number): void;
  markBlock(root: RootHex, milestone: BlockMilestone): void;
  /**
   * Starts `root`'s signature job, returning the record its stages are stamped on, which the trace reads until the
   * attempt is replaced or the slot closes; undefined when the root is untraced
   */
  signatureJob(root: RootHex): BlsJobTimes | undefined;
  /** Starts `root`'s newPayload request, returning the record of its transport times, read like a signature job's */
  executionRequest(root: RootHex): HttpRequestTimes | undefined;
  /** Records every block's dispatch experiment arm, null when the attempt takes none */
  recordArm(arm: DispatchArm | null): void;
  /**
   * Records the treatment's wait before the state transition for every block, with the attestation work during it and
   * the getBlobs call in progress it observed, read like a signature job's
   */
  recordGate(result: DispatchGateResult, getBlobs: HttpRequestTimes | null): void;
  /** Records each block's signature return wait once its verification resolved, from its signature job's stages */
  recordSignatureReturn(): void;
};

/** What a root's first getBlobs call returned: every blob, null for a missing one, or an error */
export type GetBlobsResult = "full" | "null" | "error";
const GETBLOBS_RESULTS: GetBlobsResult[] = ["full", "null", "error"];

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
  [BlockMilestone.signatureSetsBuilt]: "signature_sets_built",
  [BlockMilestone.signatureJobSelected]: "signature_job_selected",
  [BlockMilestone.signatureJobPrepared]: "signature_job_prepared",
  [BlockMilestone.signatureWorkerStart]: "signature_worker_start",
  [BlockMilestone.signatureWorkerEnd]: "signature_worker_end",
  [BlockMilestone.signatureReceipt]: "signature_receipt",
  [BlockMilestone.signaturesDone]: "signatures_done",
  [BlockMilestone.executionFirstSent]: "execution_first_sent",
  [BlockMilestone.executionDispatch]: "execution_dispatch",
  [BlockMilestone.executionReceipt]: "execution_receipt",
  [BlockMilestone.executionDone]: "execution_done",
  [BlockMilestone.dataAvailable]: "data_available",
  [BlockMilestone.getBlobsRequest]: "getblobs_request",
  [BlockMilestone.getBlobsFirstSent]: "getblobs_first_sent",
  [BlockMilestone.getBlobsDispatch]: "getblobs_dispatch",
  [BlockMilestone.getBlobsReceipt]: "getblobs_receipt",
  [BlockMilestone.getBlobsResponse]: "getblobs_response",
  [BlockMilestone.getBlobsUsable]: "getblobs_usable",
  [BlockMilestone.persistenceRequest]: "persistence_request",
  [BlockMilestone.persistenceUnblock]: "persistence_unblock",
  [BlockMilestone.forkChoice]: "fork_choice",
  [BlockMilestone.head]: "head",
};
const OBSERVED_READINESS = [
  BlockMilestone.prestateReady,
  BlockMilestone.signatureReceipt,
  BlockMilestone.signaturesDone,
  BlockMilestone.executionReceipt,
  BlockMilestone.executionDone,
  BlockMilestone.getBlobsReceipt,
  BlockMilestone.getBlobsResponse,
  BlockMilestone.getBlobsUsable,
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
/**
 * Stages inside an attempt's verification branches, also cleared when a later attempt starts. An imported block may
 * lack them: trusted signatures skip the BLS job, main-thread verification has no pool stages, and request times
 * need the HTTP client's diagnostics channels.
 */
const ATTEMPT_STAGES = [
  BlockMilestone.signatureSetsBuilt,
  BlockMilestone.signatureJobSelected,
  BlockMilestone.signatureJobPrepared,
  BlockMilestone.signatureWorkerStart,
  BlockMilestone.signatureWorkerEnd,
  BlockMilestone.signatureReceipt,
  BlockMilestone.executionFirstSent,
  BlockMilestone.executionDispatch,
  BlockMilestone.executionReceipt,
];
/** Milestones an imported block records; the gossip ones only when it arrived by gossip */
const EXPECTED_MILESTONES = [
  BlockMilestone.processorEnqueue,
  ...ATTEMPT_MILESTONES,
  BlockMilestone.dataAvailable,
  BlockMilestone.forkChoice,
  BlockMilestone.head,
];
/** Milestones read from a signature job's stage record */
const SIGNATURE_JOB_STAGES: [BlockMilestone, Exclude<keyof BlsJobTimes, "dispatchSets">][] = [
  [BlockMilestone.signatureSetsBuilt, "built"],
  [BlockMilestone.signatureJobSelected, "selected"],
  [BlockMilestone.signatureJobPrepared, "prepared"],
  [BlockMilestone.signatureWorkerStart, "workerStart"],
  [BlockMilestone.signatureWorkerEnd, "workerEnd"],
  [BlockMilestone.signatureReceipt, "received"],
];
/** Intervals observed when a slot closes, from the first milestone to the second */
const INTERVALS: [name: string, from: BlockMilestone, to: BlockMilestone][] = [
  ["signature_sets_built_to_worker_end", BlockMilestone.signatureSetsBuilt, BlockMilestone.signatureWorkerEnd],
  ["execution_dispatch_to_receipt", BlockMilestone.executionDispatch, BlockMilestone.executionReceipt],
  ["validation_end_to_getblobs_dispatch", BlockMilestone.gossipValidationEnd, BlockMilestone.getBlobsDispatch],
  ["getblobs_dispatch_to_usable", BlockMilestone.getBlobsDispatch, BlockMilestone.getBlobsUsable],
  ["gossip_admission_to_fork_choice", BlockMilestone.gossipAdmission, BlockMilestone.forkChoice],
  ["gossip_admission_to_data_available", BlockMilestone.gossipAdmission, BlockMilestone.dataAvailable],
  ["prestate_ready_to_state_transition_start", BlockMilestone.prestateReady, BlockMilestone.stateTransitionStart],
  ["state_transition_start_to_end", BlockMilestone.stateTransitionStart, BlockMilestone.stateTransitionEnd],
  [
    "state_transition_start_to_execution_first_sent",
    BlockMilestone.stateTransitionStart,
    BlockMilestone.executionFirstSent,
  ],
  [
    "state_transition_start_to_getblobs_first_sent",
    BlockMilestone.stateTransitionStart,
    BlockMilestone.getBlobsFirstSent,
  ],
];
const GOSSIP_MILESTONES = [BlockMilestone.gossipValidationStart, BlockMilestone.gossipValidationEnd];
const WAIT_COUNT = BlockWait.signatureReturn + 1;
const WAIT_NAMES: Record<BlockWait, "dispatch" | "processor" | "dispatch_gate" | "signature_return"> = {
  [BlockWait.dispatch]: "dispatch",
  [BlockWait.processor]: "processor",
  [BlockWait.dispatchGate]: "dispatch_gate",
  [BlockWait.signatureReturn]: "signature_return",
};
const ATTESTATION_DATA = "attestation_data";
/** Dispatch experiment arm labels, by 1 + the arm's index in ARMS, 0 for none */
const ARMS = [DispatchArm.control, DispatchArm.treatment];
const ARM_LABELS = ["none", ...ARMS];
/** Every fork's head vote consumes the block, so each block milestone is measured against the attestation target */
const BLOCK_TARGET = ConsumerTarget.attestationDue;

const RING_SLOTS = 128;
/** Competing roots traced per slot; more are counted as overflow */
const ROOTS_PER_SLOT = 4;
const ENTRIES = RING_SLOTS * ROOTS_PER_SLOT;
/** Attestation segments kept to count retroactively, a power of two */
const SEGMENT_LOG_SIZE = 16384;
const SEGMENT_LOG_MASK = SEGMENT_LOG_SIZE - 1;
/** Fields of a logged segment, adjacent in memory: start time, kind, duration */
const SEGMENT_FIELDS = 3;
const SAMPLE_EVERY_SLOTS = 8;
/** Slots before the clock slot that still take events; older slots are closed */
const OPEN_PAST_SLOTS = 1;

/**
 * Whether attestation segments are timed in `slot` when timing is on: one slot in SAMPLE_EVERY_SLOTS, at a position in
 * the epoch that moves by one each epoch so every position is sampled.
 */
export function isSampledSlot(slot: Slot): boolean {
  return (slot - Math.floor(slot / SLOTS_PER_EPOCH)) % SAMPLE_EVERY_SLOTS === 0;
}

/**
 * A bounded per-slot trace of each block's critical path, joined by slot and block root.
 *
 * Milestones are ms from the slot start: new ones are `performance.now()` stamps anchored to the slot start when the
 * slot's record is created, existing ones are Unix ms. A root keeps its first arrival milestones and its latest
 * processing attempt; an imported root takes no further attempts. Each root records its dispatch, processor, dispatch
 * gate and signature return waits and the gossip attestation segments that ran during them, counted from a log of
 * segment starts. Attestation work during a wait co-occurred with it, which does not establish that it delayed the
 * block.
 *
 * Storage is preallocated; recording a milestone allocates nothing. A slot closes at the start of slot + 2, when its
 * metrics are observed: "not imported" and "never head" mean by then.
 */
export class BlockTrace {
  /** Whether attestation segments are timed in the current slot, so callers can skip untimed segments */
  sampling = false;
  /** The global looked up once, as the attestation segment hooks run per batch */
  private readonly perf = performance;
  private readonly genesisMs: number;
  private readonly targets = new Map<ForkName, ConsumerTargetsMs>();
  private currentSlot: Slot;
  private currentIndex = -1;
  private currentStarts = 0;
  private currentContinuations = 0;
  private currentJsMs = 0;
  /** The last window of sampled time, in `performance.now()` time */
  private sampledFrom = Number.POSITIVE_INFINITY;
  private sampledUntil = Number.NEGATIVE_INFINITY;
  private laneFreeAt = 0;
  private generations = 0;

  private readonly slotOf = new Float64Array(RING_SLOTS).fill(-1);
  private readonly slotStart = new Float64Array(RING_SLOTS);
  private readonly closed = new Uint8Array(RING_SLOTS);
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
  /** The generation of each root's latest attempt, unique across roots */
  private readonly generation = new Float64Array(ENTRIES);
  private readonly attempts = new Uint16Array(ENTRIES);
  /** Signature sets in the worker dispatch that carried the latest attempt's signature job, 0 when not recorded */
  private readonly signatureDispatchSets = new Uint16Array(ENTRIES);
  /** The first getBlobs call's result, 1 + its index in GETBLOBS_RESULTS, 0 when not recorded */
  private readonly getBlobsResult = new Uint8Array(ENTRIES);
  /** The latest attempt's dispatch experiment arm, 1 + its index in ARMS, 0 when it took none */
  private readonly arms = new Uint8Array(ENTRIES);
  /** The latest attempt's treatment wait before the state transition */
  private readonly gates: (DispatchGateResult | null)[] = new Array<DispatchGateResult | null>(ENTRIES).fill(null);
  /**
   * The getBlobs call in progress that the latest attempt's gate observed, read like the other operations: its first
   * attempt's send in ms from the slot start, and whether it is the first call the getblobs milestones describe, 1 if it
   * is, 2 if not, 0 when not read
   */
  private readonly gateGetBlobs: (HttpRequestTimes | null)[] = new Array<HttpRequestTimes | null>(ENTRIES).fill(null);
  private readonly gateGetBlobsFirstSent = new Float64Array(ENTRIES);
  private readonly gateGetBlobsTraced = new Uint8Array(ENTRIES);
  /** The first getBlobs call's cell computation times, and its sidecar assembly's duration in ms */
  private readonly getBlobsCells: (CellComputeTimes | null)[] = new Array<CellComputeTimes | null>(ENTRIES).fill(null);
  private readonly getBlobsAssemblyMs = new Float64Array(ENTRIES);
  /**
   * Stage records of each root's operations in flight: the latest attempt's signature job and newPayload request, and
   * the first getBlobs call. Snapshots read them, and the slot's close reads them a last time and drops them.
   */
  private readonly signatureJobs: (BlsJobTimes | null)[] = new Array<BlsJobTimes | null>(ENTRIES).fill(null);
  private readonly executionRequests: (HttpRequestTimes | null)[] = new Array<HttpRequestTimes | null>(ENTRIES).fill(
    null
  );
  private readonly getBlobsRequests: (HttpRequestTimes | null)[] = new Array<HttpRequestTimes | null>(ENTRIES).fill(
    null
  );
  /** What first completed each root's data, null when not recorded */
  private readonly dataAvailableVia: (DataAvailableVia | null)[] = new Array<DataAvailableVia | null>(ENTRIES).fill(
    null
  );
  /** Per root and wait: `performance.now()` begin and end, NaN when not recorded */
  private readonly waitBegin = new Float64Array(ENTRIES * WAIT_COUNT);
  private readonly waitEnd = new Float64Array(ENTRIES * WAIT_COUNT);
  private readonly waitStarts = new Uint32Array(ENTRIES * WAIT_COUNT);
  private readonly waitContinuations = new Uint32Array(ENTRIES * WAIT_COUNT);
  private readonly waitJsMs = new Float64Array(ENTRIES * WAIT_COUNT);
  /** Fraction of the wait inside sampled time */
  private readonly waitCoverage = new Float64Array(ENTRIES * WAIT_COUNT);
  private readonly waitTruncated = new Uint8Array(ENTRIES * WAIT_COUNT);

  private readonly segments = new Float64Array(SEGMENT_LOG_SIZE * SEGMENT_FIELDS);
  private segmentHead = 0;
  private segmentsWritten = 0;

  constructor(
    private readonly config: ChainForkConfig,
    clock: IClock,
    private readonly metrics: Metrics | null,
    /** Whether to time synchronous attestation segments in sampled slots; segment counts are always kept */
    private readonly attestationTiming = false
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

  /**
   * Records the root's first getBlobs call now, and `times`, its engine request's transport times, read like a signature
   * job's; returns false for a later call or an untraced root
   */
  getBlobsRequest(slot: Slot, root: RootHex, times: HttpRequestTimes): boolean {
    const e = this.entry(slot, root);
    if (
      e < 0 ||
      !this.setMilestone(e, BlockMilestone.getBlobsRequest, performance.now() - this.slotStart[slotIndexOf(e)])
    ) {
      return false;
    }
    this.getBlobsRequests[e] = times;
    return true;
  }

  /** Records the cell computation of the root's first getBlobs call and its sidecar assembly's duration */
  getBlobsComputed(slot: Slot, root: RootHex, cells: CellComputeTimes, assemblyMs: number): void {
    const e = this.entry(slot, root);
    if (e < 0 || this.getBlobsCells[e] !== null) return;
    this.getBlobsCells[e] = cells;
    this.getBlobsAssemblyMs[e] = assemblyMs;
  }

  /** Records the root's first getBlobs response now and what it returned */
  getBlobsResponse(slot: Slot, root: RootHex, result: GetBlobsResult): void {
    const e = this.entry(slot, root);
    if (
      e >= 0 &&
      this.setMilestone(e, BlockMilestone.getBlobsResponse, performance.now() - this.slotStart[slotIndexOf(e)])
    ) {
      this.getBlobsResult[e] = GETBLOBS_RESULTS.indexOf(result) + 1;
    }
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
      for (const m of ATTEMPT_STAGES) this.milestones[e * MILESTONE_COUNT + m] = NaN;
      this.signatureDispatchSets[e] = 0;
      this.arms[e] = 0;
      this.clearGate(e);
      this.signatureJobs[e] = null;
      this.executionRequests[e] = null;
      this.setMilestone(e, BlockMilestone.processorStart, now - this.slotStart[slotIndexOf(e)]);
      this.setWait(e, BlockWait.processor, waitFrom, now);
      this.waitBegin[e * WAIT_COUNT + BlockWait.dispatchGate] = NaN;
      this.waitBegin[e * WAIT_COUNT + BlockWait.signatureReturn] = NaN;
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
    /** The entry of `root` while this attempt is its latest and its slot is open, else -1 */
    const currentEntry = (root: RootHex): number => {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (this.roots[e] !== root) continue;
        return this.generation[e] === generations[i] && this.closed[slotIndexOf(e)] === 0 ? e : -1;
      }
      return -1;
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
      signatureJob: (root) => {
        const e = currentEntry(root);
        if (e < 0) return undefined;
        const times = new BlsJobTimes();
        this.signatureJobs[e] = times;
        return times;
      },
      executionRequest: (root) => {
        const e = currentEntry(root);
        if (e < 0) return undefined;
        const times = new HttpRequestTimes();
        this.executionRequests[e] = times;
        return times;
      },
      recordArm: (arm) => {
        for (const block of blocks) {
          const e = currentEntry(block.blockRootHex);
          if (e >= 0) this.arms[e] = arm === null ? 0 : ARMS.indexOf(arm) + 1;
        }
      },
      recordGate: (result, getBlobs) => {
        for (const block of blocks) {
          const e = currentEntry(block.blockRootHex);
          if (e < 0) continue;
          this.gates[e] = result;
          this.gateGetBlobs[e] = getBlobs;
          this.setWait(e, BlockWait.dispatchGate, result.start, result.start + result.ms);
        }
      },
      recordSignatureReturn: () => {
        for (const block of blocks) {
          const e = currentEntry(block.blockRootHex);
          const job = e >= 0 ? this.signatureJobs[e] : null;
          if (job !== null && !Number.isNaN(job.workerEnd) && !Number.isNaN(job.received)) {
            this.setWait(e, BlockWait.signatureReturn, job.workerEnd, job.received);
          }
        }
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

  /**
   * Logs a gossip attestation batch's start. Unless segments are timed, the processor's job start stamp stands in for
   * a clock read. Returns the handle `attestationSegmentEnd` takes when the segment is timed, else -1.
   */
  attestationBatchStart(startUnixSec: number | null | undefined): number {
    const at =
      this.sampling || startUnixSec == null || this.currentIndex < 0
        ? this.perf.now()
        : startUnixSec * 1000 - this.slotStartMs(this.currentSlot) + this.slotStart[this.currentIndex];
    return this.logSegment(AttestationSegment.start, at);
  }

  /**
   * Logs a batch resuming after its signatures were verified. Unless segments are timed, `resultAt`, the time the
   * worker result reached JS, stands in for a clock read.
   */
  attestationContinuation(resultAt: number | undefined): number {
    return this.logSegment(
      AttestationSegment.continuation,
      this.sampling || resultAt === undefined || Number.isNaN(resultAt) ? this.perf.now() : resultAt
    );
  }

  /** Logs a batch resuming in a microtask of its previous segment, only when segments are timed */
  attestationMicrotask(): number {
    return this.sampling ? this.logSegment(AttestationSegment.microtask, this.perf.now()) : -1;
  }

  private logSegment(kind: AttestationSegment, at: number): number {
    const i = this.segmentHead;
    const field = i * SEGMENT_FIELDS;
    this.segments[field] = at;
    this.segments[field + 1] = kind;
    this.segments[field + 2] = NaN;
    this.segmentHead = (i + 1) & SEGMENT_LOG_MASK;
    this.segmentsWritten++;
    if (kind === AttestationSegment.start) this.currentStarts++;
    else if (kind === AttestationSegment.continuation) this.currentContinuations++;
    return this.sampling ? i : -1;
  }

  attestationSegmentEnd(segment: number): void {
    if (segment < 0) return;
    const field = segment * SEGMENT_FIELDS;
    const duration = this.perf.now() - this.segments[field];
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
      milestoneNames: Object.values(MILESTONE_NAMES),
      observedReadiness: OBSERVED_READINESS.map((m) => MILESTONE_NAMES[m]),
      slots,
    };
  }

  private readonly onClockSlot = (slot: Slot): void => {
    this.flushAttestationWork();
    this.currentSlot = slot;
    for (let s = 0; s < RING_SLOTS; s++) {
      if (this.slotOf[s] >= 0 && this.closed[s] === 0 && this.slotOf[s] < slot - OPEN_PAST_SLOTS) this.closeSlot(s);
    }
    this.currentIndex = this.slotIndex(slot);
    const sampling = this.attestationTiming && isSampledSlot(slot);
    if (sampling && !this.sampling) {
      this.sampledFrom = performance.now();
      this.sampledUntil = Number.POSITIVE_INFINITY;
    } else if (!sampling && this.sampling) {
      this.sampledUntil = performance.now();
    }
    this.sampling = sampling;
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
    if (held >= 0 && this.closed[s] === 0) this.closeSlot(s);
    this.slotOf[s] = slot;
    this.slotStart[s] = performance.now() - (Date.now() - this.slotStartMs(slot));
    this.closed[s] = 0;
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
    this.signatureDispatchSets[e] = 0;
    this.getBlobsResult[e] = 0;
    this.arms[e] = 0;
    this.clearGate(e);
    this.getBlobsCells[e] = null;
    this.signatureJobs[e] = null;
    this.executionRequests[e] = null;
    this.getBlobsRequests[e] = null;
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

  /** Records the wait `[begin, end]`, closed now, and the attestation segments that started during it */
  private setWait(e: number, wait: BlockWait, begin: number, end: number): void {
    const w = e * WAIT_COUNT + wait;
    this.waitBegin[w] = begin;
    this.waitEnd[w] = Math.max(begin, end);
    this.waitStarts[w] = 0;
    this.waitContinuations[w] = 0;
    this.waitJsMs[w] = 0;
    this.waitTruncated[w] = 0;
    if (!(end > begin)) {
      this.waitCoverage[w] = 1;
      return;
    }
    this.waitCoverage[w] =
      Math.max(0, Math.min(end, this.sampledUntil) - Math.max(begin, this.sampledFrom)) / (end - begin);

    // Stamps from the processor and BLS results precede their logging, so the log is scanned whole, not in time order
    const logged = Math.min(this.segmentsWritten, SEGMENT_LOG_SIZE);
    let oldest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < logged; i++) {
      const field = i * SEGMENT_FIELDS;
      const t = this.segments[field];
      const duration = this.segments[field + 2];
      if (t < oldest) oldest = t;
      if (t > end) continue;
      if (t < begin) {
        // A timed segment that straddles `begin` contributes its part inside
        if (t + duration > begin) this.waitJsMs[w] += Math.min(t + duration, end) - begin;
        continue;
      }
      const kind = this.segments[field + 1];
      if (kind === AttestationSegment.start) this.waitStarts[w]++;
      else if (kind === AttestationSegment.continuation) this.waitContinuations[w]++;
      if (!Number.isNaN(duration)) this.waitJsMs[w] += Math.min(duration, end - t);
    }
    if (this.segmentsWritten > SEGMENT_LOG_SIZE && oldest > begin) this.waitTruncated[w] = 1;
  }

  /** Copies the stages a root's records have reached into its milestones; a record keeps each stage's latest value */
  private readStages(e: number): void {
    const start = this.slotStart[slotIndexOf(e)];
    const offset = e * MILESTONE_COUNT;
    const job = this.signatureJobs[e];
    if (job !== null) {
      for (const [m, stage] of SIGNATURE_JOB_STAGES) this.milestones[offset + m] = job[stage] - start;
      this.signatureDispatchSets[e] = job.dispatchSets;
    }
    const execution = this.executionRequests[e];
    if (execution !== null) {
      this.milestones[offset + BlockMilestone.executionFirstSent] = execution.firstSent - start;
      this.milestones[offset + BlockMilestone.executionDispatch] = execution.sent - start;
      this.milestones[offset + BlockMilestone.executionReceipt] = execution.received - start;
    }
    const getBlobs = this.getBlobsRequests[e];
    if (getBlobs !== null) {
      this.milestones[offset + BlockMilestone.getBlobsFirstSent] = getBlobs.firstSent - start;
      this.milestones[offset + BlockMilestone.getBlobsDispatch] = getBlobs.sent - start;
      this.milestones[offset + BlockMilestone.getBlobsReceipt] = getBlobs.received - start;
    }
    const gateGetBlobs = this.gateGetBlobs[e];
    if (gateGetBlobs !== null) {
      this.gateGetBlobsFirstSent[e] = gateGetBlobs.firstSent - start;
      this.gateGetBlobsTraced[e] = gateGetBlobs === getBlobs ? 1 : 2;
    }
  }

  private outcome(e: number): "head" | "imported" | "not_imported" {
    if (this.has(e, BlockMilestone.head)) return "head";
    return this.has(e, BlockMilestone.forkChoice) ? "imported" : "not_imported";
  }

  private closeSlot(s: number): void {
    const first = s * ROOTS_PER_SLOT;
    const last = first + this.rootCount[s];
    // Keep the stages operations still in flight have reached, and none after
    for (let e = first; e < last; e++) {
      this.readStages(e);
      this.signatureJobs[e] = null;
      this.executionRequests[e] = null;
      this.getBlobsRequests[e] = null;
      this.gateGetBlobs[e] = null;
    }
    this.closed[s] = 1;
    const metrics = this.metrics?.blockTrace;
    if (!metrics) return;
    const slot = this.slotOf[s];
    const due = this.getTargets(slot)[BLOCK_TARGET] ?? 0;

    if (this.attDataCount[s] > 0) {
      const ms = this.attDataMs[s];
      // The arm of the slot's block the data selected
      let arm = ARM_LABELS[0];
      let selected = last > first ? "other_root" : "no_block";
      for (let e = first; e < last; e++) {
        if (this.roots[e] !== this.attDataRoot[s]) continue;
        selected = "slot_block";
        arm = ARM_LABELS[this.arms[e]];
      }
      metrics.milestone.observe({milestone: ATTESTATION_DATA, arm}, ms / 1000);
      metrics.milestoneToTarget.observe({milestone: ATTESTATION_DATA, target: BLOCK_TARGET, arm}, (ms - due) / 1000);
      if (ms > due) metrics.milestoneLate.inc({milestone: ATTESTATION_DATA});
      metrics.attestationData.inc({selected});
    }

    for (let e = first; e < last; e++) {
      const outcome = this.outcome(e);
      const arm = ARM_LABELS[this.arms[e]];
      metrics.blocks.inc({outcome, arm});
      const offset = e * MILESTONE_COUNT;
      for (let m = 0; m < MILESTONE_COUNT; m++) {
        const ms = this.milestones[offset + m];
        if (Number.isNaN(ms)) continue;
        const milestone = MILESTONE_NAMES[m as BlockMilestone];
        metrics.milestone.observe({milestone, arm}, ms / 1000);
        metrics.milestoneToTarget.observe({milestone, target: BLOCK_TARGET, arm}, (ms - due) / 1000);
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
      if (!Number.isNaN(persistence)) {
        metrics.wait.observe({wait: "persistence", arm}, Math.max(0, persistence) / 1000);
      }
      for (const [interval, from, to] of INTERVALS) {
        const ms = this.milestones[offset + to] - this.milestones[offset + from];
        if (!Number.isNaN(ms)) metrics.interval.observe({interval, arm}, ms / 1000);
      }
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
        const name = WAIT_NAMES[wait as BlockWait];
        metrics.wait.observe({wait: name, arm}, (this.waitEnd[w] - this.waitBegin[w]) / 1000);
        metrics.waitAttestationSegments.observe({wait: name, kind: "start"}, this.waitStarts[w]);
        metrics.waitAttestationSegments.observe({wait: name, kind: "continuation"}, this.waitContinuations[w]);
        const truncated = this.waitTruncated[w] === 1;
        if (truncated) metrics.attestationLogTruncated.inc();
        if (!this.attestationTiming) continue;
        const coverage = truncated ? "truncated" : samplingCoverage(this.waitCoverage[w]);
        metrics.waitSampling.inc({wait: name, coverage});
        if (coverage === "full") metrics.waitAttestationJs.observe({wait: name}, this.waitJsMs[w] / 1000);
      }
    }
  }

  private clearGate(e: number): void {
    this.gates[e] = null;
    this.gateGetBlobs[e] = null;
    this.gateGetBlobsFirstSent[e] = NaN;
    this.gateGetBlobsTraced[e] = 0;
  }

  private gateSnapshot(e: number): routes.lodestar.BlockTraceRoot["dispatchGate"] {
    const gate = this.gates[e];
    if (gate === null) return null;
    const {outcome, getBlobs, settledMs, ms} = gate;
    const firstSent = this.gateGetBlobsFirstSent[e];
    const traced = this.gateGetBlobsTraced[e];
    return {
      outcome,
      getBlobs,
      getBlobsFirstSentMs: Number.isNaN(firstSent) ? null : round(firstSent),
      getBlobsTraced: traced === 0 ? null : traced === 1,
      settledMs: round(settledMs),
      ms: round(ms),
      pastDeadlineMs: round(pastDeadlineMs(gate)),
    };
  }

  private cellsSnapshot(e: number, start: number): routes.lodestar.BlockTraceRoot["getBlobsCells"] {
    const cells = this.getBlobsCells[e];
    if (cells === null) return null;
    return {
      submittedMs: cells.submitted.map((at) => round(at - start)),
      resumedMs: cells.resumed.map((at) => round(at - start)),
      assemblyMs: round(this.getBlobsAssemblyMs[e]),
    };
  }

  private waitSnapshot(e: number, wait: BlockWait, start: number): routes.lodestar.BlockTraceWait | null {
    const w = e * WAIT_COUNT + wait;
    if (Number.isNaN(this.waitBegin[w])) return null;
    return {
      beginMs: round(this.waitBegin[w] - start),
      endMs: round(this.waitEnd[w] - start),
      attestationStarts: this.waitStarts[w],
      attestationContinuations: this.waitContinuations[w],
      attestationJsMs: round(this.waitJsMs[w]),
      sampledCoverage: round(this.waitCoverage[w]),
      attestationLogTruncated: this.waitTruncated[w] === 1,
    };
  }

  private slotSnapshot(s: number): routes.lodestar.BlockTraceSlot {
    const slot = this.slotOf[s];
    const start = this.slotStart[s];
    const sampled = this.attestationTiming && isSampledSlot(slot);
    const current = s === this.currentIndex && slot === this.currentSlot;
    const roots: routes.lodestar.BlockTraceRoot[] = [];
    const first = s * ROOTS_PER_SLOT;
    for (let e = first; e < first + this.rootCount[s]; e++) {
      this.readStages(e);
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
        arm: this.arms[e] === 0 ? null : ARMS[this.arms[e] - 1],
        dispatchGate: this.gateSnapshot(e),
        milestones,
        signatureDispatchSets: this.signatureDispatchSets[e] > 0 ? this.signatureDispatchSets[e] : null,
        getBlobsResult: this.getBlobsResult[e] > 0 ? GETBLOBS_RESULTS[this.getBlobsResult[e] - 1] : null,
        getBlobsCells: this.cellsSnapshot(e, start),
        dataAvailableVia: this.dataAvailableVia[e],
        waits: {
          dispatch: this.waitSnapshot(e, BlockWait.dispatch, start),
          processor: this.waitSnapshot(e, BlockWait.processor, start),
          dispatchGate: this.waitSnapshot(e, BlockWait.dispatchGate, start),
          signatureReturn: this.waitSnapshot(e, BlockWait.signatureReturn, start),
        },
      });
    }
    const attDataRoot = this.attDataRoot[s];
    return {
      slot,
      fork: this.config.getForkName(slot),
      closed: this.closed[s] === 1,
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

function samplingCoverage(coverage: number): "full" | "partial" | "none" {
  if (coverage >= 1) return "full";
  return coverage > 0 ? "partial" : "none";
}

function slotIndexOf(entry: number): number {
  return Math.floor(entry / ROOTS_PER_SLOT);
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}
