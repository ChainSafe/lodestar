import {createHash, randomBytes} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {Writable} from "node:stream";
import {createZstdCompress, constants as zlibConstants} from "node:zlib";
import {BeaconConfig} from "@lodestar/config";
import {AGGREGATORS_PER_COMMITTEE, ForkName} from "@lodestar/params";
import {computeTimeAtSlot} from "@lodestar/state-transition";
import {Slot} from "@lodestar/types";
import {Logger, toHex} from "@lodestar/utils";

/**
 * A record of when pq attestations arrive and how long their proofs take, in the format of
 * Lighthouse's pq-measurement reports, which Prysm writes too: its `plot.py` renders a run of any
 * of the three. A run is a directory with `run.json` and chunks of zstd compressed JSON lines.
 *
 * Nothing here may slow the node: an event is a push to a bounded queue, dropped and counted when
 * the queue is full, and a failed write ends the recording.
 */

const SCHEMA_VERSION = 1;
const QUEUE_SIZE = 16384;
const CHUNK_MAX_BYTES = 64 * 1024 * 1024;
const CHUNK_MAX_MS = 300_000;
const RETAINED_BYTES = 8 * 1024 * 1024 * 1024;
const MANIFEST_INTERVAL_MS = 10_000;
/** An experiment of the observer mode starts every this many slots */
export const SAMPLING_STRIDE = 3;

/** What a full queue drops is counted by these */
type EventClass = "receipt" | "validation" | "work" | "status";

export type PqTimingFields = Record<string, unknown>;

/** How proving is laid out in a slot, for the reports to place events against */
export type PqTimingSchedule = {
  /** Into its slot, when a committee's single attestations are proven */
  committeeCollectionMs: number;
  /** Into the slot two before a proposal, when its attestation proofs are first merged */
  initialMergeMs: number;
  /** Into the slot of a proposal, when a merge not yet done is given up */
  fallbackDeadlineMs: number;
};

export type PqTimingOpts = {
  /** Where runs go: each in a directory of its own */
  output: string;
  /** Whether the node runs experiments of its own beside its duties */
  observer: boolean;
  version: string;
  proverLogInvRate: number;
  genesisTime: number;
  schedule: PqTimingSchedule;
};

type Chunk = {name: string; bytes: number; first: number; last: number};

type OpenChunk = {
  name: string;
  compressor: Writable;
  file: fs.WriteStream;
  openedMs: number;
  bytes: number;
  first: number;
  last: number;
};

export type PqProofWork = "committee" | "initial" | "improvement" | "fallback";

/** What the observer mode runs a proof for: nothing a validator asked for */
export type PqExperiment = {
  /** The slot the experiment is anchored at */
  id: Slot;
  scenario: "committee_only" | "proposer_only" | "combined";
  committeeCount: number;
  activeValidators: number;
};

export class PqTiming {
  readonly seed: bigint;
  private readonly dir: string;
  private readonly manifest: PqTimingFields;
  private readonly originWallNs: bigint;
  private readonly originMonoNs: bigint;
  private readonly slotMs: number;
  private readonly aggregateDueMs: number;
  /** When the aggregate of the last of a committee's aggregators is due */
  private readonly lastAggregateDueMs: number;

  private queue: string[] = [];
  /** The sequence numbers of the first and the last event queued */
  private queueSeqs: [number, number] | null = null;
  private writing: Promise<void> | null = null;
  private chunk: OpenChunk | null = null;
  private readonly chunks: Chunk[] = [];
  private chunkCount = 0;
  private evictedChunks = 0;
  private evictedBounds: [number, number] | null = null;
  private readonly dropped: Record<EventClass, number> = {receipt: 0, validation: 0, work: 0, status: 0};
  private droppedSeq: [number, number] | null = null;
  private droppedWallNs: [bigint, bigint] | null = null;
  private seq = 0;
  private jobCount = 0;
  private failed = false;
  private closed = false;
  private ended = false;
  private lastManifestMs = Date.now();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly config: BeaconConfig,
    private readonly logger: Logger,
    private readonly opts: PqTimingOpts
  ) {
    this.seed = randomBytes(8).readBigUInt64LE();
    this.originMonoNs = process.hrtime.bigint();
    this.originWallNs = BigInt(Date.now()) * 1_000_000n;
    this.slotMs = config.getSlotComponentDurationMs(ForkName.pq, 10_000);
    this.aggregateDueMs = config.getAggregateDueMs(ForkName.pq);
    this.lastAggregateDueMs = config.getAggregateDueMs(ForkName.pq, AGGREGATORS_PER_COMMITTEE - 1);

    const runId = `${this.originWallNs}-${this.seed.toString(16).padStart(16, "0")}`;
    this.dir = path.join(opts.output, runId);
    fs.mkdirSync(this.dir, {recursive: true});

    const threads = Number.parseInt(process.env.LEANVM_NUM_THREADS ?? "", 10);
    this.manifest = {
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      started_unix_ns: this.originWallNs,
      observer: opts.observer,
      network: config.CONFIG_NAME,
      genesis_time: opts.genesisTime,
      genesis_slot: 0,
      genesis_validators_root: toHex(config.genesisValidatorsRoot),
      client: "lodestar",
      lodestar_version: opts.version,
      prover_backend: "leanvm-in-process",
      prover_log_inv_rate: opts.proverLogInvRate,
      prover_cpu_profile: null,
      prover_threads: null,
      prover_threads_configured: Number.isNaN(threads) ? null : threads,
      hardware: getHardware(),
      timing: {
        slot_ns: msToNs(this.slotMs),
        attestation_ns: msToNs(config.getAttestationDueMs(ForkName.pq)),
        committee_collection_ns: msToNs(opts.schedule.committeeCollectionMs),
        aggregate_ns: msToNs(this.aggregateDueMs),
        initial_merge_ns: msToNs(opts.schedule.initialMergeMs),
        proposal_lag_slots: 2,
      },
      sampling: {seed: this.seed, anchor_phase: Number(this.seed % BigInt(SAMPLING_STRIDE)), stride: SAMPLING_STRIDE},
      receive_point: "gossipsub delivery, after Snappy decompression and before SSZ decode, to the millisecond",
    };
    this.writeManifest();
    this.logger.info("Recording pq timing", {dir: this.dir});

    this.timer = setInterval(() => this.flush(), MANIFEST_INTERVAL_MS);
    this.timer.unref();
  }

  /** A pq attestation or aggregate from gossip, with what validation made of it */
  onGossipMessage(
    message: {
      kind: "individual" | "aggregate";
      id: string;
      slot: Slot;
      committee: number;
      subnet: number | null;
      bytes: number;
      signers: number;
      dataRoot: Uint8Array;
    },
    seenTimestampSec: number,
    outcome: "accepted" | "ignored" | "rejected"
  ): void {
    if (this.failed) return;
    const now = this.now();
    const seenWallNs = BigInt(Math.round(seenTimestampSec * 1000)) * 1_000_000n;
    const sinceSeenNs = now.wallNs > seenWallNs ? now.wallNs - seenWallNs : 0n;
    const common = {
      message_kind: message.kind,
      message_id: message.id,
      source: "network",
      reference_slot: message.slot,
      slot: message.slot,
    };
    this.emit(
      "receipt",
      "message_received",
      {
        ...common,
        committee: message.committee,
        subnet: message.subnet,
        message_bytes: message.bytes,
        byte_basis: "decoded_ssz",
        signer_count: message.signers,
        vote_data_root: toHex(message.dataRoot),
      },
      {wallNs: seenWallNs, monoNs: now.monoNs - sinceSeenNs}
    );
    this.emit("validation", "validated", {...common, outcome, receipt_to_validation_ns: sinceSeenNs}, now);
  }

  /**
   * A proof to make. `slot` is the slot of a committee's attestations, or the slot of the block a
   * merge is for.
   */
  job(work: PqProofWork, slot: Slot, round: number, experiment?: PqExperiment): PqTimingJob {
    return new PqTimingJob(this, ++this.jobCount, work, slot, round, experiment ?? null);
  }

  /** What a proposer had merged when its slot came */
  onProposal(slot: Slot, prepared: {proof: Uint8Array; participation: number; records: number} | null): void {
    this.emit("status", "proposal_snapshot", {
      origin: "production",
      scenario: "production",
      sequence_id: `production:${slot}`,
      reference_slot: slot - 2,
      slot,
      outcome: prepared ? "candidate" : "no_candidate",
      proof_id: prepared ? proofId(prepared.proof) : null,
      participation: prepared?.participation ?? null,
      records: prepared?.records ?? null,
      active_job_id: null,
    });
  }

  /** Whether the time is at or past this long into `slot` */
  isPast(slot: Slot, msIntoSlot: number): boolean {
    return Date.now() >= computeTimeAtSlot(this.config, slot, this.opts.genesisTime) * 1000 + msIntoSlot;
  }

  /** When a proof of `work` for `slot` is of no use any more */
  isLate(work: PqProofWork, slot: Slot): boolean {
    switch (work) {
      case "committee":
        return this.isPast(slot, this.lastAggregateDueMs);
      case "fallback":
        return this.isPast(slot, this.opts.schedule.fallbackDeadlineMs);
      default:
        return this.isPast(slot, 0);
    }
  }

  now(): {wallNs: bigint; monoNs: bigint} {
    const monoNs = process.hrtime.bigint() - this.originMonoNs;
    return {wallNs: this.originWallNs + monoNs, monoNs};
  }

  emit(eventClass: EventClass, kind: string, fields: PqTimingFields, at = this.now()): void {
    if (this.failed || this.closed) return;
    const seq = ++this.seq;
    if (this.queue.length >= QUEUE_SIZE) {
      this.dropped[eventClass]++;
      this.droppedSeq = [this.droppedSeq?.[0] ?? seq, seq];
      this.droppedWallNs = [this.droppedWallNs?.[0] ?? at.wallNs, at.wallNs];
      return;
    }
    this.queue.push(stringify({seq, kind, wall_ns: at.wallNs, mono_ns: at.monoNs, ...fields}));
    this.queueSeqs = [this.queueSeqs?.[0] ?? seq, seq];
    this.flush();
  }

  /** Finishes the last chunk and the manifest */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    this.flush();
    while (this.writing !== null) await this.writing;
  }

  /** Writes what is queued, one writer at a time */
  private flush(): void {
    if (this.writing || this.failed) return;
    this.writing = this.write()
      .catch((e) => {
        this.failed = true;
        this.ended = true;
        this.queue = [];
        this.queueSeqs = null;
        this.logger.error("Stopped recording pq timing: writing it failed", {dir: this.dir}, e as Error);
        try {
          this.writeManifest();
        } catch {
          // The directory is gone or full: the log line above is the record of it
        }
      })
      .finally(() => {
        this.writing = null;
        // Events queued, or the recording closed, while this one wrote
        if (this.queue.length > 0 || (this.closed && !this.ended)) this.flush();
      });
  }

  private async write(): Promise<void> {
    while (this.queue.length > 0) {
      const lines = this.queue;
      const [first, last] = this.queueSeqs as [number, number];
      this.queue = [];
      this.queueSeqs = null;

      this.chunk ??= this.openChunk(first);
      const data = Buffer.from(`${lines.join("\n")}\n`);
      this.chunk.bytes += data.length;
      this.chunk.last = last;
      if (!this.chunk.compressor.write(data)) {
        await new Promise((resolve) => (this.chunk as OpenChunk).compressor.once("drain", resolve));
      }
      if (this.chunk.bytes >= CHUNK_MAX_BYTES) await this.closeChunk();
    }

    if (this.chunk && (this.closed || Date.now() - this.chunk.openedMs >= CHUNK_MAX_MS)) await this.closeChunk();
    if (this.closed) {
      this.ended = true;
      this.manifest.ended_unix_ns = this.now().wallNs;
      this.writeManifest();
    } else if (Date.now() - this.lastManifestMs >= MANIFEST_INTERVAL_MS) {
      this.writeManifest();
    }
  }

  private openChunk(first: number): OpenChunk {
    const name = `events-${String(++this.chunkCount).padStart(6, "0")}.jsonl.zst`;
    const compressor = createZstdCompress({params: {[zlibConstants.ZSTD_c_compressionLevel]: 1}});
    const file = fs.createWriteStream(path.join(this.dir, `${name}.partial`));
    compressor.pipe(file);
    return {name, compressor, file, openedMs: Date.now(), bytes: 0, first, last: first};
  }

  /** A chunk is one zstd frame, listed in the manifest once it is whole */
  private async closeChunk(): Promise<void> {
    const {name, compressor, file, first, last} = this.chunk as OpenChunk;
    this.chunk = null;
    await new Promise<void>((resolve, reject) => {
      file.once("finish", resolve);
      file.once("error", reject);
      compressor.once("error", reject);
      compressor.end();
    });
    const filepath = path.join(this.dir, name);
    fs.renameSync(`${filepath}.partial`, filepath);
    this.chunks.push({name, bytes: fs.statSync(filepath).size, first, last});

    let retained = this.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
    while (retained > RETAINED_BYTES && this.chunks.length > 1) {
      const evicted = this.chunks.shift() as Chunk;
      fs.rmSync(path.join(this.dir, evicted.name));
      retained -= evicted.bytes;
      this.evictedChunks++;
      this.evictedBounds = [this.evictedBounds?.[0] ?? evicted.first, evicted.last];
    }
    this.writeManifest();
  }

  /** Replaced whole, so that a reader never sees half of one */
  private writeManifest(): void {
    this.lastManifestMs = Date.now();
    const manifest = {
      ...this.manifest,
      chunks: this.chunks,
      recorder_status: {
        disk_failed: this.failed,
        dropped: this.dropped,
        first_dropped_sequence: this.droppedSeq?.[0] ?? null,
        last_dropped_sequence: this.droppedSeq?.[1] ?? 0,
        submitted_sequence: this.seq,
        first_dropped_wall_ns: this.droppedWallNs?.[0] ?? null,
        last_dropped_wall_ns: this.droppedWallNs?.[1] ?? null,
        evicted_chunks: this.evictedChunks,
        evicted_sequence_bounds: this.evictedBounds,
        checked_unix_ns: this.now().wallNs,
      },
    };
    const filepath = path.join(this.dir, "run.json");
    fs.writeFileSync(`${filepath}.partial`, `${stringify(manifest, 2)}\n`);
    fs.renameSync(`${filepath}.partial`, filepath);
  }
}

/** One proof, from when it is asked for to what came of it */
export class PqTimingJob {
  private readonly enqueuedWallNs: bigint;

  constructor(
    private readonly timing: PqTiming,
    private readonly id: number,
    private readonly work: PqProofWork,
    private readonly slot: Slot,
    private readonly round: number,
    private readonly experiment: PqExperiment | null
  ) {
    this.enqueuedWallNs = timing.now().wallNs;
  }

  emit(kind: string, outcome: string, fields: PqTimingFields = {}): void {
    const {experiment} = this;
    this.timing.emit("work", kind, {
      outcome,
      job_id: this.id,
      work: this.work,
      origin: experiment ? "measurement" : "production",
      slot: this.slot,
      // The reports place a merge against the slot whose attestations it is the first to take
      reference_slot: experiment?.id ?? (this.work === "committee" ? this.slot : this.slot - 2),
      round: this.round,
      previous_recursive_depth: 0,
      experiment_id: experiment?.id ?? null,
      sequence_id: experiment ? `measurement:${experiment.id}` : `production:${this.slot}`,
      scenario: experiment?.scenario ?? "production",
      committee_count: experiment?.committeeCount ?? null,
      active_validators: experiment?.activeValidators ?? null,
      enqueued_wall_ns: this.enqueuedWallNs,
      ...fields,
    });
  }

  /**
   * Times `prove`. leanVM runs one proof at a time and queues the rest itself, so the duration
   * holds whatever the proof waited behind another.
   */
  async run<T extends {proof: Uint8Array}>(prove: () => Promise<T>, fields: PqTimingFields = {}): Promise<T> {
    this.emit("proof_started", "started", fields);
    const start = process.hrtime.bigint();
    try {
      const proven = await prove();
      this.emit("proof_finished", "success", {
        ...fields,
        backend_duration_ns: process.hrtime.bigint() - start,
        late: this.timing.isLate(this.work, this.slot),
        proof_bytes: proven.proof.length,
        proof_id: proofId(proven.proof),
      });
      return proven;
    } catch (e) {
      this.emit("proof_finished", "failed", {
        ...fields,
        backend_duration_ns: process.hrtime.bigint() - start,
        late: this.timing.isLate(this.work, this.slot),
        proof_bytes: null,
        proof_id: null,
      });
      throw e;
    }
  }
}

export function proofId(proof: Uint8Array): string {
  return toHex(createHash("sha256").update(proof).digest());
}

function msToNs(ms: number): number {
  return Math.round(ms * 1_000_000);
}

/** JSON with integers past 2^53 written in full */
function stringify(value: unknown, space?: number): string {
  return JSON.stringify(
    value,
    // biome-ignore lint/suspicious/noExplicitAny: `JSON.rawJSON` is not in the TypeScript library yet
    (_key, item) => (typeof item === "bigint" ? (JSON as any).rawJSON(item.toString()) : item),
    space
  );
}

function getHardware(): PqTimingFields {
  const cpuMax = readCgroup("cpu.max")?.split(" ");
  const memoryMax = readCgroup("memory.max");
  return {
    architecture: os.arch(),
    os: os.platform(),
    kernel: os.release(),
    cpu_model: os.cpus()[0]?.model ?? null,
    available_parallelism: os.availableParallelism(),
    cpu_affinity: null,
    cgroup_cpu_equivalents: cpuMax && cpuMax[0] !== "max" ? Number(cpuMax[0]) / Number(cpuMax[1]) : null,
    visible_memory_bytes: os.totalmem(),
    cgroup_memory_bytes: memoryMax && memoryMax !== "max" ? Number(memoryMax) : null,
  };
}

function readCgroup(file: string): string | null {
  try {
    return fs.readFileSync(path.join("/sys/fs/cgroup", file), "utf8").trim();
  } catch {
    return null;
  }
}
