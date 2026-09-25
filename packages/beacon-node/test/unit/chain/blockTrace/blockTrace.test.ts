import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {
  AttestationSegment,
  BlockMilestone,
  BlockTrace,
  ConsumerTarget,
  getConsumerTargetsMs,
  isSampledSlot,
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
      rootsOverflow: counter(),
      stage: histogram(),
      verifyLast: counter(),
      runnableImport: histogram(),
      runnableImportAttestationSegments: histogram(),
      runnableImportAttestationJs: histogram(),
      attestationLogTruncated: counter(),
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
    root(ofSlot: Slot) {
      const snapshot = trace.getSnapshot().slots.find((s) => s.slot === ofSlot);
      if (!snapshot) throw Error(`No slot ${ofSlot}`);
      return snapshot;
    },
  };
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

  it("records milestones in ms from the slot start, from monotonic and Unix stamps", () => {
    const slot = 100;
    const t = setup(slot);
    const root = "0xaa";
    const seenTimestampSec = (slot * slotMs + 1000) / 1000;
    t.at(1200);
    t.trace.gossipValidationStart(slot, root, seenTimestampSec, performance.now());
    t.at(1250);
    t.trace.mark(slot, root, BlockMilestone.gossipValidationEnd);
    t.trace.markAllUnixMs([{slot, blockRootHex: root}], BlockMilestone.stateTransitionEnd, slot * slotMs + 1400);
    // A milestone keeps its first value
    t.at(1500);
    t.trace.mark(slot, root, BlockMilestone.gossipValidationEnd);

    const [traced] = t.root(slot).roots;
    expect(traced.root).toBe(root);
    expect(traced.outcome).toBe("pending");
    expect(traced.milestones).toEqual({
      gossip_admission: 1000,
      gossip_validation_start: 1200,
      gossip_validation_end: 1250,
      state_transition_end: 1400,
    });
    expect(traced.runnableImport.intervals).toEqual([[1000, 1200]]);
    expect(traced.runnableImport.ms).toBe(200);
  });

  it("counts attestation segments inside the union of runnable-import intervals", () => {
    const slot = 100;
    const t = setup(slot);
    const root = "0xaa";
    const block = {slot, blockRootHex: root};
    t.at(500);
    t.trace.attestationSegmentStart(AttestationSegment.start);
    t.at(1050);
    t.trace.attestationSegmentStart(AttestationSegment.start);
    t.at(1100);
    t.trace.attestationSegmentStart(AttestationSegment.start);
    t.at(1150);
    t.trace.attestationSegmentStart(AttestationSegment.continuation);
    t.at(1200);
    t.trace.gossipValidationStart(slot, root, (slot * slotMs + 1000) / 1000, performance.now());

    // Enqueued while the processor ran another job; its wait counts from the lane freeing
    t.at(1300);
    const enqueuedAt = performance.now();
    t.trace.markAll([block], BlockMilestone.processorEnqueue, enqueuedAt);
    t.at(1400);
    t.trace.processorIdle();
    t.at(1420);
    t.trace.attestationSegmentStart(AttestationSegment.continuation);
    t.at(1450);
    t.trace.processorStart([block], enqueuedAt);

    const {runnableImport, milestones} = t.root(slot).roots[0];
    expect(milestones.processor_enqueue).toBe(1300);
    expect(milestones.processor_start).toBe(1450);
    expect(runnableImport.intervals).toEqual([
      [1000, 1200],
      [1400, 1450],
    ]);
    expect(runnableImport.ms).toBe(250);
    expect(runnableImport.attestationStarts).toBe(2);
    expect(runnableImport.attestationContinuations).toBe(2);
    expect(runnableImport.attestationLogTruncated).toBe(false);
    expect(t.root(slot).attestationWork).toMatchObject({starts: 3, continuations: 2});
  });

  it("times attestation segments only in sampled slots", () => {
    const sampled = findSlot(100, true);
    const t = setup(sampled);
    t.at(1000);
    const start = t.trace.attestationSegmentStart(AttestationSegment.start);
    t.at(1005);
    t.trace.attestationSegmentEnd(start);
    const microtask = t.trace.attestationSegmentStart(AttestationSegment.microtask);
    t.at(1007);
    t.trace.attestationSegmentEnd(microtask);
    expect(t.root(sampled).sampled).toBe(true);
    expect(t.root(sampled).attestationWork).toEqual({starts: 1, continuations: 0, jsMs: 7});

    const unsampled = findSlot(sampled + 1, false);
    t.toSlot(unsampled);
    t.at(1000);
    const later = t.trace.attestationSegmentStart(AttestationSegment.start);
    t.at(1005);
    t.trace.attestationSegmentEnd(later);
    expect(t.trace.attestationSegmentStart(AttestationSegment.microtask)).toBe(-1);
    expect(t.root(unsampled).attestationWork).toEqual({starts: 1, continuations: 0, jsMs: null});
  });

  it("bounds competing roots per slot and counts the overflow once per root", () => {
    const slot = 100;
    const t = setup(slot);
    for (const root of ["0x01", "0x02", "0x03", "0x04", "0x05", "0x05"]) {
      t.trace.mark(slot, root, BlockMilestone.processorEnqueue);
    }
    expect(t.root(slot).roots.map((r) => r.root)).toEqual(["0x01", "0x02", "0x03", "0x04"]);
    expect(t.root(slot).rootsOverflow).toBe(1);
    expect(t.metrics.rootsOverflow.inc).toHaveBeenCalledTimes(1);
  });

  it("ignores slots outside the open window", () => {
    const slot = 100;
    const t = setup(slot);
    t.trace.mark(slot - 2, "0xaa", BlockMilestone.processorEnqueue);
    t.trace.mark(slot + 2, "0xbb", BlockMilestone.processorEnqueue);
    expect(t.trace.getSnapshot().slots.map((s) => s.slot)).toEqual([slot]);
  });

  it("observes outcomes and metrics when a slot is finalized", () => {
    const slot = 100;
    const t = setup(slot);
    const head = "0xaa";
    const other = "0xbb";
    const dropped = "0xcc";
    t.at(1000);
    for (const root of [head, other]) {
      for (const milestone of [BlockMilestone.processorEnqueue, BlockMilestone.forkChoice]) {
        t.trace.mark(slot, root, milestone);
      }
    }
    t.trace.mark(slot, dropped, BlockMilestone.processorEnqueue);
    t.at(1100);
    t.trace.mark(slot, head, BlockMilestone.head);
    t.at(attestationDueMs + 10);
    t.trace.attestationData(slot, head);
    t.trace.attestationData(slot, other);

    t.toSlot(slot + 1);
    expect(t.root(slot).finalized).toBe(false);
    t.toSlot(slot + 2);

    const {roots, finalized, attestationData} = t.root(slot);
    expect(finalized).toBe(true);
    expect(roots.map((r) => r.outcome)).toEqual(["head", "imported", "not_imported"]);
    expect(attestationData).toEqual({ms: attestationDueMs + 10, root: head, count: 2, rootChanged: true});
    expect(t.metrics.blocks.inc.mock.calls).toEqual([
      [{outcome: "head"}],
      [{outcome: "imported"}],
      [{outcome: "not_imported"}],
    ]);
    expect(t.metrics.milestoneMissing.inc).toHaveBeenCalledWith({milestone: "head"});
    expect(t.metrics.milestoneToTarget.observe).toHaveBeenCalledWith(
      {milestone: "fork_choice", target: ConsumerTarget.attestationDue},
      (1000 - attestationDueMs) / 1000
    );
    expect(t.metrics.milestoneLate.inc).toHaveBeenCalledWith({milestone: "attestation_data"});
    expect(t.metrics.attestationData.inc).toHaveBeenCalledWith({selected: "slot_block"});
    expect(t.metrics.stage.observe).toHaveBeenCalledWith({stage: "head"}, 0.1);
  });
});

describe("getConsumerTargetsMs", () => {
  it("derives each fork's targets from the slot duration", () => {
    const gloasConfig = createChainForkConfig({...defaultChainConfig, SLOT_DURATION_MS: 6000});
    const bps = (bps: number): number => Math.round((bps * 6000) / 10000);
    expect(getConsumerTargetsMs(gloasConfig, ForkName.fulu)).toEqual({
      [ConsumerTarget.attestationDue]: bps(gloasConfig.ATTESTATION_DUE_BPS),
      [ConsumerTarget.aggregateDue]: bps(gloasConfig.AGGREGATE_DUE_BPS),
      [ConsumerTarget.syncMessageDue]: bps(gloasConfig.SYNC_MESSAGE_DUE_BPS),
      [ConsumerTarget.contributionDue]: bps(gloasConfig.CONTRIBUTION_DUE_BPS),
      [ConsumerTarget.payloadDue]: null,
      [ConsumerTarget.payloadAttestationDue]: null,
    });
    expect(getConsumerTargetsMs(gloasConfig, ForkName.gloas)).toEqual({
      [ConsumerTarget.attestationDue]: bps(gloasConfig.ATTESTATION_DUE_BPS_GLOAS),
      [ConsumerTarget.aggregateDue]: bps(gloasConfig.AGGREGATE_DUE_BPS_GLOAS),
      [ConsumerTarget.syncMessageDue]: bps(gloasConfig.SYNC_MESSAGE_DUE_BPS_GLOAS),
      [ConsumerTarget.contributionDue]: bps(gloasConfig.CONTRIBUTION_DUE_BPS_GLOAS),
      [ConsumerTarget.payloadDue]: bps(gloasConfig.PAYLOAD_DUE_BPS),
      [ConsumerTarget.payloadAttestationDue]: bps(gloasConfig.PAYLOAD_ATTESTATION_DUE_BPS),
    });
    expect(getConsumerTargetsMs(gloasConfig, ForkName.phase0)[ConsumerTarget.syncMessageDue]).toBeNull();
  });
});
