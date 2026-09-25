import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {SignatureSetType} from "@lodestar/state-transition";
import {Slot, ssz} from "@lodestar/types";
import {BlockInputSource, DataAvailableVia, IBlockInput} from "../../../../src/chain/blocks/blockInput/index.js";
import {
  BlockMilestone,
  BlockTrace,
  ConsumerTarget,
  getConsumerTargetsMs,
  isSampledSlot,
} from "../../../../src/chain/blockTrace/index.js";
import {BlsJobTimes} from "../../../../src/chain/bls/index.js";
import {IBeaconChain} from "../../../../src/chain/index.js";
import {SeenAttesters} from "../../../../src/chain/seenCache/seenAttesters.js";
import {
  GossipAttestation,
  Step0Result,
  validateGossipAttestationsSameAttData,
} from "../../../../src/chain/validation/index.js";
import {HttpRequestTimes} from "../../../../src/execution/engine/jsonRpcHttpClient.js";
import {Metrics} from "../../../../src/metrics/index.js";
import {ClockEvent} from "../../../../src/util/clock.js";
import {ClockStopped} from "../../../mocks/clock.js";

const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
});
const slotMs = config.SLOT_DURATION_MS;
const attestationDueMs = config.getAttestationDueMs(ForkName.fulu);

function mockMetrics() {
  const histogram = () => ({observe: vi.fn()});
  const counter = () => ({inc: vi.fn()});
  return {
    blockTrace: {
      milestone: histogram(),
      milestoneToTarget: histogram(),
      milestoneLate: counter(),
      milestoneMissing: counter(),
      blocks: counter(),
      dataAvailable: counter(),
      rootsOverflow: counter(),
      wait: histogram(),
      interval: histogram(),
      waitAttestationSegments: histogram(),
      waitAttestationJs: histogram(),
      waitSampling: counter(),
      attestationLogTruncated: counter(),
      attestationData: counter(),
    },
  };
}

/** A trace whose clock is at the start of `slot`; `at(ms)` moves time to `ms` after the clock slot's start */
function setup(slot: Slot, attestationTiming = false) {
  vi.useFakeTimers({toFake: ["Date", "performance"], now: slot * slotMs});
  const clock = new ClockStopped(slot);
  const metrics = mockMetrics();
  const trace = new BlockTrace(config, clock, metrics as unknown as Metrics, attestationTiming);
  return {
    trace,
    metrics: metrics.blockTrace,
    at(ms: number): void {
      vi.advanceTimersByTime(clock.currentSlot * slotMs + ms - Date.now());
    },
    toSlot(next: Slot): void {
      vi.advanceTimersByTime(next * slotMs - Date.now());
      clock.setSlot(next);
      clock.emit(ClockEvent.slot, next);
    },
    slot(ofSlot: Slot) {
      const snapshot = trace.getSnapshot().slots.find((s) => s.slot === ofSlot);
      if (!snapshot) throw Error(`No slot ${ofSlot}`);
      return snapshot;
    },
    milestones(ofSlot: Slot, index = 0): Record<string, number | null> {
      const {milestoneNames} = trace.getSnapshot();
      const {milestones} = this.slot(ofSlot).roots[index];
      return Object.fromEntries(milestoneNames.map((name, i) => [name, milestones[i]]));
    },
  };
}

/** A block input whose data becomes available when `available` is called */
function block(slot: Slot, blockRootHex: string) {
  let observer: ((at: number, via: DataAvailableVia) => void) | null = null;
  const input = {
    slot,
    blockRootHex,
    observeDataAvailable: (fn: (at: number, via: DataAvailableVia) => void) => {
      observer = fn;
    },
  } as unknown as IBlockInput;
  return Object.assign(input, {
    available: (via: DataAvailableVia = {source: BlockInputSource.gossip, reconstructable: false}) =>
      observer?.(performance.now(), via),
  });
}

/** The first slot at or after `from` whose attestation segments are timed, or not */
function findSlot(from: Slot, sampled: boolean): Slot {
  let slot = from;
  while (isSampledSlot(slot) !== sampled) slot++;
  return slot;
}

describe("BlockTrace", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("records arrival milestones and the dispatch wait in ms from the slot start", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1200);
    t.trace.gossipValidationStart(slot, "0xaa", (slot * slotMs + 1000) / 1000, performance.now());
    t.at(1250);
    t.trace.mark(slot, "0xaa", BlockMilestone.gossipValidationEnd);
    // An arrival milestone keeps its first value
    t.at(1500);
    t.trace.mark(slot, "0xaa", BlockMilestone.gossipValidationEnd);

    expect(t.milestones(slot)).toMatchObject({
      gossip_admission: 1000,
      gossip_validation_start: 1200,
      gossip_validation_end: 1250,
      processor_start: null,
    });
    expect(t.slot(slot).roots[0].outcome).toBe("pending");
    expect(t.slot(slot).roots[0].waits).toMatchObject({dispatch: {beginMs: 1000, endMs: 1200}, processor: null});
  });

  it("records each branch of an attempt when it completes and keeps the pending work when the slot closes", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1000);
    const attempt = t.trace.startAttempt([block(slot, "0xaa")], performance.now());
    t.at(1100);
    attempt?.mark(BlockMilestone.stateTransitionStart);
    attempt?.markUnixMs(BlockMilestone.stateTransitionEnd, slot * slotMs + 1300);
    attempt?.markUnixMs(BlockMilestone.signaturesDone, slot * slotMs + 1400);

    t.toSlot(slot + 2);
    expect(t.slot(slot).closed).toBe(true);
    expect(t.slot(slot).roots[0].outcome).toBe("not_imported");
    expect(t.milestones(slot)).toMatchObject({state_transition_end: 1300, signatures_done: 1400, data_available: null});
    expect(t.metrics.blocks.inc).toHaveBeenCalledWith({outcome: "not_imported"});
    expect(t.metrics.milestone.observe).toHaveBeenCalledWith({milestone: "signatures_done"}, 1.4);
    expect(t.metrics.milestoneMissing.inc).toHaveBeenCalledWith({milestone: "data_available", outcome: "not_imported"});
    expect(t.metrics.milestoneMissing.inc).not.toHaveBeenCalledWith({
      milestone: "signatures_done",
      outcome: "not_imported",
    });
    expect(t.metrics.wait.observe).toHaveBeenCalledWith({wait: "processor"}, 0);
  });

  it("records a block's signature job stages per root, and drops a replaced attempt's", () => {
    const slot = 100;
    const t = setup(slot);
    const [a, b] = [block(slot, "0xaa"), block(slot, "0xbb")];
    t.at(1000);
    const first = t.trace.startAttempt([a], performance.now());
    t.at(1100);
    const second = t.trace.startAttempt([a, b], performance.now());
    const times = (at: number): BlsJobTimes =>
      Object.assign(new BlsJobTimes(), {
        built: performance.now() + at,
        selected: performance.now() + at + 5,
        prepared: performance.now() + at + 6,
        workerStart: performance.now() + at + 8,
        workerEnd: performance.now() + at + 40,
        received: performance.now() + at + 45,
        dispatchSets: 12,
      });
    first?.signatureJob("0xaa", times(-50));
    second?.signatureJob("0xbb", times(100));
    // A verification the pool never dispatched leaves its later stages unrecorded
    second?.signatureJob("0xaa", Object.assign(new BlsJobTimes(), {built: performance.now() + 100}));

    expect(t.milestones(slot, 0)).toMatchObject({
      signature_sets_built: 1200,
      signature_job_selected: null,
      signature_receipt: null,
    });
    expect(t.slot(slot).roots[0].signatureDispatchSets).toBeNull();
    expect(t.milestones(slot, 1)).toMatchObject({
      signature_sets_built: 1200,
      signature_job_selected: 1205,
      signature_job_prepared: 1206,
      signature_worker_start: 1208,
      signature_worker_end: 1240,
      signature_receipt: 1245,
    });
    expect(t.slot(slot).roots[1].signatureDispatchSets).toBe(12);

    t.toSlot(slot + 2);
    expect(t.metrics.interval.observe).toHaveBeenCalledWith({interval: "signature_sets_built_to_worker_end"}, 0.04);
    expect(t.metrics.milestoneMissing.inc).not.toHaveBeenCalledWith({
      milestone: "signature_job_selected",
      outcome: "not_imported",
    });
  });

  it("records engine request transport times apart from their continuations", () => {
    const slot = 100;
    const t = setup(slot);
    const requestTimes = (sent: number, received: number): HttpRequestTimes =>
      Object.assign(new HttpRequestTimes(), {sent: performance.now() + sent, received: performance.now() + received});
    t.at(900);
    t.trace.gossipValidationStart(slot, "0xaa", (slot * slotMs + 850) / 1000, performance.now());
    t.at(950);
    t.trace.mark(slot, "0xaa", BlockMilestone.gossipValidationEnd);
    const attempt = t.trace.startAttempt([block(slot, "0xaa")], performance.now());
    t.at(1000);
    expect(t.trace.getBlobsRequest(slot, "0xaa")).toBe(true);
    t.at(1200);
    attempt?.executionRequest("0xaa", requestTimes(-150, -20));
    attempt?.markUnixMs(BlockMilestone.executionDone, Date.now());
    t.trace.getBlobsResponse(slot, "0xaa", requestTimes(-110, -60), "full");
    t.at(1300);
    t.trace.mark(slot, "0xaa", BlockMilestone.getBlobsUsable);
    // A later call's response is not the first call's
    t.trace.getBlobsResponse(slot, "0xaa", requestTimes(0, 10), "null");

    expect(t.milestones(slot)).toMatchObject({
      execution_dispatch: 1050,
      execution_receipt: 1180,
      execution_done: 1200,
      getblobs_request: 1000,
      getblobs_dispatch: 1090,
      getblobs_receipt: 1140,
      getblobs_response: 1200,
      getblobs_usable: 1300,
    });
    expect(t.slot(slot).roots[0].getBlobsResult).toBe("full");

    t.toSlot(slot + 2);
    expect(t.metrics.interval.observe).toHaveBeenCalledWith({interval: "execution_dispatch_to_receipt"}, 0.13);
    expect(t.metrics.interval.observe).toHaveBeenCalledWith({interval: "validation_end_to_getblobs_dispatch"}, 0.14);
    expect(t.metrics.interval.observe).toHaveBeenCalledWith({interval: "getblobs_dispatch_to_usable"}, 0.21);
  });

  it("clears a failed attempt, drops its late marks, and takes no attempt after import", () => {
    const slot = 100;
    const t = setup(slot);
    const root = "0xaa";
    t.at(1000);
    const first = t.trace.startAttempt([block(slot, root)], performance.now());
    first?.mark(BlockMilestone.prestateRequest);
    t.trace.processorLaneFree();

    t.at(1200);
    const second = t.trace.startAttempt([block(slot, root)], performance.now());
    t.at(1300);
    first?.markUnixMs(BlockMilestone.signaturesDone, Date.now());
    second?.mark(BlockMilestone.prestateRequest);
    t.at(1400);
    t.trace.mark(slot, root, BlockMilestone.forkChoice);
    t.trace.processorLaneFree();

    // A duplicate job after import neither restarts the attempt nor extends its wait
    t.at(1500);
    t.trace.attestationBatchStart(null);
    expect(t.trace.startAttempt([block(slot, root)], performance.now() - 100)).toBeNull();

    expect(t.slot(slot).roots[0].attempts).toBe(2);
    expect(t.milestones(slot)).toMatchObject({processor_start: 1200, prestate_request: 1300, signatures_done: null});
    expect(t.slot(slot).roots[0].waits.processor).toMatchObject({beginMs: 1200, endMs: 1200, attestationStarts: 0});
  });

  it("counts attestation segments during the processor wait from the lane freeing", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1300);
    const enqueuedAt = performance.now();
    t.trace.enqueued([block(slot, "0xaa")], enqueuedAt);
    t.at(1400);
    t.trace.processorLaneFree();
    t.trace.attestationBatchStart(null);
    t.at(1420);
    t.trace.attestationContinuation(undefined);
    t.trace.attestationBatchStart(null);
    t.at(1450);
    t.trace.startAttempt([block(slot, "0xaa")], enqueuedAt);

    expect(t.milestones(slot)).toMatchObject({processor_enqueue: 1300, processor_start: 1450});
    expect(t.slot(slot).roots[0].waits.processor).toMatchObject({
      beginMs: 1400,
      endMs: 1450,
      attestationStarts: 2,
      attestationContinuations: 1,
      attestationLogTruncated: false,
    });
  });

  it("marks attestation time complete only for waits wholly in sampled slots", () => {
    const sampled = findSlot(101, true);
    const t = setup(sampled - 1, true);
    t.toSlot(sampled);
    t.at(1000);
    const segment = t.trace.attestationBatchStart(null);
    t.at(1005);
    t.trace.attestationSegmentEnd(segment);
    t.at(1100);
    t.trace.gossipValidationStart(sampled, "0xaa", (sampled * slotMs + 900) / 1000, performance.now());
    expect(t.slot(sampled).roots[0].waits.dispatch).toMatchObject({attestationJsMs: 5, sampledCoverage: 1});

    // A wait that runs into the next, unsampled slot has partial coverage
    t.at(slotMs - 100);
    const late = t.trace.attestationBatchStart(null);
    t.at(slotMs - 90);
    t.trace.attestationSegmentEnd(late);
    t.toSlot(sampled + 1);
    t.at(100);
    t.trace.gossipValidationStart(sampled, "0xbb", (sampled * slotMs + slotMs - 200) / 1000, performance.now());
    expect(t.slot(sampled).roots[1].waits.dispatch).toMatchObject({
      attestationStarts: 1,
      attestationJsMs: 10,
      sampledCoverage: 0.667,
    });
    expect(t.slot(sampled + 1).attestationWork.jsMs).toBeNull();

    t.toSlot(sampled + 3);
    expect(t.metrics.waitSampling.inc).toHaveBeenCalledWith({wait: "dispatch", coverage: "full"});
    expect(t.metrics.waitSampling.inc).toHaveBeenCalledWith({wait: "dispatch", coverage: "partial"});
    expect(t.metrics.waitAttestationJs.observe).toHaveBeenCalledTimes(1);
  });

  it("times each resume of batch validation up to its next await", async () => {
    const t = setup(findSlot(100, true), true);
    const signingRoot = Buffer.alloc(32, 1);
    const chain = {
      blockTrace: t.trace,
      seenAttesters: new SeenAttesters(),
      opts: {minSameMessageSignatureSetsToBatch: 2},
      bls: {
        verifySignatureSetsSameMessage: (sets: unknown[]) => {
          vi.advanceTimersByTime(3);
          return Promise.resolve(sets.map(() => true));
        },
      },
    } as unknown as IBeaconChain;
    let validatorIndex = 0;
    const step0 = async (): Promise<Step0Result> => {
      vi.advanceTimersByTime(2);
      return {
        attestation: ssz.phase0.Attestation.defaultValue(),
        signatureSet: {type: SignatureSetType.indexed, index: 0, signingRoot, signature: new Uint8Array(96)},
        validatorIndex: validatorIndex++,
      } as Partial<Step0Result> as Step0Result;
    };

    await validateGossipAttestationsSameAttData(
      ForkName.phase0,
      chain,
      new Array<GossipAttestation>(3).fill({} as GossipAttestation),
      step0
    );

    // The first step0 runs in the caller's segment; the other two and the signature submission are timed
    expect(t.slot(findSlot(100, true)).attestationWork).toEqual({starts: 0, continuations: 1, jsMs: 7});
  });

  it("records data availability and what completed it when the block input's data arrives", () => {
    const slot = 100;
    const t = setup(slot);
    const input = block(slot, "0xaa");
    t.at(900);
    t.trace.enqueued([input], performance.now());
    t.at(1200);
    input.available({source: BlockInputSource.engine, reconstructable: true});
    expect(t.milestones(slot)).toMatchObject({processor_enqueue: 900, data_available: 1200, processor_start: null});
    expect(t.slot(slot).roots[0].dataAvailableVia).toEqual({source: "engine", reconstructable: true});

    t.toSlot(slot + 2);
    expect(t.metrics.dataAvailable.inc).toHaveBeenCalledWith({source: "engine", completion: "reconstructable"});
  });

  it("keeps a job still queued when its slot closes, and rejects an attempt's marks after the close", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1000);
    t.trace.enqueued([block(slot, "0xaa")], performance.now());
    const attempt = t.trace.startAttempt([block(slot, "0xbb")], performance.now());

    t.toSlot(slot + 2);
    attempt?.mark(BlockMilestone.prestateRequest);
    expect(t.slot(slot).roots.map((r) => r.outcome)).toEqual(["not_imported", "not_imported"]);
    expect(t.milestones(slot, 0)).toMatchObject({processor_enqueue: 1000, processor_start: null});
    expect(t.milestones(slot, 1)).toMatchObject({processor_start: 1000, prestate_request: null});
    expect(t.metrics.milestoneMissing.inc).toHaveBeenCalledWith({
      milestone: "processor_start",
      outcome: "not_imported",
    });
  });

  it("counts attestation segments without timing them when timing is off", () => {
    const sampled = findSlot(100, true);
    const t = setup(sampled);
    t.at(1000);
    expect(t.trace.attestationBatchStart(null)).toBe(-1);
    expect(t.trace.attestationMicrotask()).toBe(-1);
    t.trace.attestationContinuation(undefined);
    t.at(1100);
    t.trace.gossipValidationStart(sampled, "0xaa", (sampled * slotMs + 900) / 1000, performance.now());
    expect(t.slot(sampled).sampled).toBe(false);
    expect(t.slot(sampled).attestationWork).toEqual({starts: 1, continuations: 1, jsMs: null});
    expect(t.slot(sampled).roots[0].waits.dispatch).toMatchObject({attestationStarts: 1, attestationContinuations: 1});

    t.toSlot(sampled + 2);
    expect(t.metrics.waitSampling.inc).not.toHaveBeenCalled();
    expect(t.metrics.waitAttestationJs.observe).not.toHaveBeenCalled();
  });

  it("stamps untimed segments with the processor start and worker result times, not the clock", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1000);
    t.trace.attestationBatchStart((slot * slotMs + 850) / 1000);
    t.trace.attestationBatchStart((slot * slotMs + 950) / 1000);
    t.trace.attestationContinuation(performance.now() - 120);
    t.trace.attestationContinuation(performance.now() + 50);
    t.at(1100);
    t.trace.gossipValidationStart(slot, "0xaa", (slot * slotMs + 900) / 1000, performance.now());
    expect(t.slot(slot).roots[0].waits.dispatch).toMatchObject({attestationStarts: 1, attestationContinuations: 1});
  });

  it("leaves a wait whose log wrapped out of complete attestation time", () => {
    const sampled = findSlot(101, true);
    const t = setup(sampled - 1, true);
    t.toSlot(sampled);
    t.at(1000);
    for (let i = 0; i < 16384 + 1; i++) {
      t.trace.attestationSegmentEnd(t.trace.attestationBatchStart(null));
    }
    t.at(1100);
    t.trace.gossipValidationStart(sampled, "0xaa", (sampled * slotMs + 900) / 1000, performance.now());
    expect(t.slot(sampled).roots[0].waits.dispatch).toMatchObject({attestationLogTruncated: true, sampledCoverage: 1});

    t.toSlot(sampled + 2);
    expect(t.metrics.waitSampling.inc).toHaveBeenCalledWith({wait: "dispatch", coverage: "truncated"});
    expect(t.metrics.waitAttestationJs.observe).not.toHaveBeenCalled();
    expect(t.metrics.attestationLogTruncated.inc).toHaveBeenCalledTimes(1);
  });

  it("bounds competing roots per slot and counts changes of overflowing root", () => {
    const slot = 100;
    const t = setup(slot);
    for (const root of ["0x01", "0x02", "0x03", "0x04", "0x05", "0x05"]) {
      t.trace.mark(slot, root, BlockMilestone.gossipValidationEnd);
    }
    expect(t.slot(slot).roots.map((r) => r.root)).toEqual(["0x01", "0x02", "0x03", "0x04"]);
    expect(t.slot(slot).rootsOverflow).toBe(1);
    expect(t.metrics.rootsOverflow.inc).toHaveBeenCalledTimes(1);
  });

  it("ignores slots outside the open window", () => {
    const slot = 100;
    const t = setup(slot);
    t.trace.mark(slot - 2, "0xaa", BlockMilestone.gossipValidationEnd);
    t.trace.mark(slot + 2, "0xbb", BlockMilestone.gossipValidationEnd);
    expect(t.trace.getSnapshot().slots.map((s) => s.slot)).toEqual([slot]);
  });

  it("pairs the first getBlobs call and commits attestation data when returned", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1000);
    expect(t.trace.getBlobsRequest(slot, "0xaa")).toBe(true);
    t.at(1100);
    expect(t.trace.getBlobsRequest(slot, "0xaa")).toBe(false);
    t.trace.mark(slot, "0xaa", BlockMilestone.getBlobsResponse);
    t.at(1200);
    t.trace.mark(slot, "0xaa", BlockMilestone.head);
    t.at(attestationDueMs + 20);
    t.trace.attestationData(slot, "0xaa", performance.now() - 10);
    t.trace.attestationData(slot, "0xbb", performance.now());
    expect(t.milestones(slot)).toMatchObject({getblobs_request: 1000, getblobs_response: 1100});
    expect(t.slot(slot).attestationData).toEqual({
      ms: attestationDueMs + 10,
      root: "0xaa",
      count: 2,
      rootChanged: true,
    });

    t.toSlot(slot + 2);
    expect(t.metrics.attestationData.inc).toHaveBeenCalledWith({selected: "slot_block"});
    expect(t.metrics.milestoneLate.inc).toHaveBeenCalledWith({milestone: "attestation_data"});
    expect(t.metrics.milestoneToTarget.observe).toHaveBeenCalledWith(
      {milestone: "head", target: ConsumerTarget.attestationDue},
      (1200 - attestationDueMs) / 1000
    );
    expect(t.metrics.blocks.inc).toHaveBeenCalledWith({outcome: "head"});
  });
});

describe("getConsumerTargetsMs", () => {
  it("derives each fork's targets from the slot duration", () => {
    const shortSlots = createChainForkConfig({...defaultChainConfig, SLOT_DURATION_MS: 6000});
    const bps = (bps: number): number => Math.round((bps * 6000) / 10000);
    expect(getConsumerTargetsMs(shortSlots, ForkName.fulu)).toEqual({
      [ConsumerTarget.attestationDue]: bps(shortSlots.ATTESTATION_DUE_BPS),
      [ConsumerTarget.aggregateDue]: bps(shortSlots.AGGREGATE_DUE_BPS),
      [ConsumerTarget.syncMessageDue]: bps(shortSlots.SYNC_MESSAGE_DUE_BPS),
      [ConsumerTarget.contributionDue]: bps(shortSlots.CONTRIBUTION_DUE_BPS),
      [ConsumerTarget.payloadDue]: null,
      [ConsumerTarget.payloadAttestationDue]: null,
    });
    expect(getConsumerTargetsMs(shortSlots, ForkName.gloas)).toEqual({
      [ConsumerTarget.attestationDue]: bps(shortSlots.ATTESTATION_DUE_BPS_GLOAS),
      [ConsumerTarget.aggregateDue]: bps(shortSlots.AGGREGATE_DUE_BPS_GLOAS),
      [ConsumerTarget.syncMessageDue]: bps(shortSlots.SYNC_MESSAGE_DUE_BPS_GLOAS),
      [ConsumerTarget.contributionDue]: bps(shortSlots.CONTRIBUTION_DUE_BPS_GLOAS),
      [ConsumerTarget.payloadDue]: bps(shortSlots.PAYLOAD_DUE_BPS),
      [ConsumerTarget.payloadAttestationDue]: bps(shortSlots.PAYLOAD_ATTESTATION_DUE_BPS),
    });
    expect(getConsumerTargetsMs(shortSlots, ForkName.phase0)[ConsumerTarget.syncMessageDue]).toBeNull();
  });
});
