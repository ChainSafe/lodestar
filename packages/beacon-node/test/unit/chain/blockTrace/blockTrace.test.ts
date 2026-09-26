import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {BlockInputSource, DataAvailableVia, IBlockInput} from "../../../../src/chain/blocks/blockInput/index.js";
import {
  BlockMilestone,
  BlockTrace,
  ConsumerTarget,
  getConsumerTargetsMs,
} from "../../../../src/chain/blockTrace/index.js";
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
      attestationData: counter(),
    },
  };
}

/** A trace whose clock is at the start of `slot`; `at(ms)` moves time to `ms` after the clock slot's start */
function setup(slot: Slot) {
  vi.useFakeTimers({toFake: ["Date", "performance"], now: slot * slotMs});
  const clock = new ClockStopped(slot);
  const metrics = mockMetrics();
  const trace = new BlockTrace(config, clock, metrics as unknown as Metrics);
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
    expect(t.trace.startAttempt([block(slot, root)], performance.now() - 100)).toBeNull();

    expect(t.slot(slot).roots[0].attempts).toBe(2);
    expect(t.milestones(slot)).toMatchObject({processor_start: 1200, prestate_request: 1300, signatures_done: null});
    expect(t.slot(slot).roots[0].waits.processor).toEqual({beginMs: 1200, endMs: 1200});
  });

  it("records the processor wait from the lane freeing", () => {
    const slot = 100;
    const t = setup(slot);
    t.at(1300);
    const enqueuedAt = performance.now();
    t.trace.enqueued([block(slot, "0xaa")], enqueuedAt);
    t.at(1400);
    t.trace.processorLaneFree();
    t.at(1450);
    t.trace.startAttempt([block(slot, "0xaa")], enqueuedAt);

    expect(t.milestones(slot)).toMatchObject({processor_enqueue: 1300, processor_start: 1450});
    expect(t.slot(slot).roots[0].waits.processor).toEqual({beginMs: 1400, endMs: 1450});
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
