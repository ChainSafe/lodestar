import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {
  getSlotDurationSec,
  getSlotPosition,
  initSlotTimingMetrics,
  observeBlockArrival,
  observeBlockBecomeHead,
  setSlotDurationGauge,
} from "../../../src/chain/slotTimingMetrics.js";
import {OpSource} from "../../../src/chain/validatorMonitor.js";
import {Metrics} from "../../../src/metrics/index.js";
import {createMetricsTest} from "../metrics/utils.js";

const HEZE_FORK_EPOCH = 2;
const config = createChainForkConfig({
  ...defaultConfig,
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
  GLOAS_FORK_EPOCH: 0,
  HEZE_FORK_EPOCH,
  SLOT_DURATION_MS: 12000,
  SLOT_DURATION_MS_HEZE: 10000,
});
const gloasSlot = computeStartSlotAtEpoch(HEZE_FORK_EPOCH) - 1;
const hezeSlot = computeStartSlotAtEpoch(HEZE_FORK_EPOCH);

type MetricValue = {value: number; labels: Record<string, string | number>; metricName?: string};

async function getValues(metrics: Metrics, name: string): Promise<MetricValue[]> {
  const metric = metrics.register.getSingleMetric(name);
  if (!metric) throw Error(`metric ${name} not registered`);
  const {values} = await metric.get();
  return values as MetricValue[];
}

function matches(labels: Record<string, string | number>, expected: Record<string, string | number>): boolean {
  return Object.entries(expected).every(([key, value]) => labels[key] === value);
}

async function histogramSamples(
  metrics: Metrics,
  name: string,
  labels: Record<string, string | number> = {}
): Promise<{count: number; sum: number}> {
  const values = await getValues(metrics, name);
  const count = values.find((v) => v.metricName === `${name}_count` && matches(v.labels, labels))?.value ?? 0;
  const sum = values.find((v) => v.metricName === `${name}_sum` && matches(v.labels, labels))?.value ?? 0;
  return {count, sum};
}

async function sampleValue(
  metrics: Metrics,
  name: string,
  labels: Record<string, string | number> = {}
): Promise<number | undefined> {
  const values = await getValues(metrics, name);
  return values.find((v) => matches(v.labels, labels))?.value;
}

describe("chain / slotTimingMetrics", () => {
  let metrics: Metrics;

  beforeEach(() => {
    metrics = createMetricsTest();
  });

  afterEach(() => {
    metrics.register.clear();
  });

  it("uses the slot duration of the fork at the measured slot", () => {
    expect(getSlotDurationSec(config, gloasSlot)).toBe(12);
    expect(getSlotDurationSec(config, hezeSlot)).toBe(10);
    expect(getSlotDurationSec(config, -1)).toBe(12);
  });

  it("labels the last slot of an epoch as epoch_end", () => {
    expect(getSlotPosition(SLOTS_PER_EPOCH - 1)).toBe("epoch_end");
    expect(getSlotPosition(SLOTS_PER_EPOCH)).toBe("other");
    expect(getSlotPosition(0)).toBe("other");
  });

  describe("observeBlockArrival", () => {
    it.each([
      {slot: gloasSlot, fraction: 2 / 12},
      {slot: hezeSlot, fraction: 2 / 10},
    ])("observes 2s at slot $slot as $fraction of the block slot", async ({slot, fraction}) => {
      observeBlockArrival(metrics, config, OpSource.gossip, slot, 2);

      const seconds = await histogramSamples(metrics, "lodestar_gossip_block_elapsed_time_till_received", {
        source: OpSource.gossip,
      });
      const fractions = await histogramSamples(metrics, "lodestar_gossip_block_arrival_slot_fraction", {
        source: OpSource.gossip,
      });
      expect(seconds).toEqual({count: 1, sum: 2});
      expect(fractions.count).toBe(1);
      expect(fractions.sum).toBeCloseTo(fraction, 10);
    });
  });

  describe("observeBlockBecomeHead", () => {
    it.each([
      {headSlot: gloasSlot, fraction: 2 / 12},
      {headSlot: hezeSlot, fraction: 2 / 10},
    ])("divides by the head slot's duration at slot $headSlot", async ({headSlot, fraction}) => {
      observeBlockBecomeHead(metrics, config, headSlot, 2);

      const seconds = await histogramSamples(metrics, "lodestar_gossip_block_elapsed_time_till_become_head");
      const fractions = await histogramSamples(metrics, "lodestar_import_block_become_head_slot_fraction");
      expect(seconds).toEqual({count: 1, sum: 2});
      expect(fractions.count).toBe(1);
      expect(fractions.sum).toBeCloseTo(fraction, 10);
    });

    it("skips heads older than an epoch so sync does not distort the population", async () => {
      observeBlockBecomeHead(metrics, config, hezeSlot, SLOTS_PER_EPOCH * 10);

      const fractions = await histogramSamples(metrics, "lodestar_import_block_become_head_slot_fraction");
      expect(fractions.count).toBe(0);
    });

    it.each([
      // ATTESTATION_DUE_BPS_GLOAS=2500 of 12s is 3s, of 10s is 2.5s
      {headSlot: gloasSlot, delaySec: 2.9, missed: 0},
      {headSlot: gloasSlot, delaySec: 3.1, missed: 1},
      {headSlot: hezeSlot, delaySec: 2.6, missed: 1},
      {headSlot: hezeSlot, delaySec: 2.4, missed: 0},
    ])(
      "compares against the head slot's attestation due point (slot $headSlot, $delaySec s, missed=$missed)",
      async ({headSlot, delaySec, missed}) => {
        observeBlockBecomeHead(metrics, config, headSlot, delaySec);

        const fractions = await histogramSamples(metrics, "lodestar_import_block_become_head_slot_fraction");
        expect(fractions.count).toBe(1);
        expect(await sampleValue(metrics, "lodestar_import_block_set_head_after_cutoff_total")).toBe(missed);
        expect(
          await sampleValue(metrics, "lodestar_deadline_missed_total", {
            deadline: "attestation_due",
            task: "block_become_head",
          })
        ).toBe(missed || undefined);
      }
    );
  });

  describe("slot duration gauge", () => {
    it.each([
      {slot: -1, seconds: 12},
      {slot: gloasSlot, seconds: 12},
      {slot: hezeSlot, seconds: 10},
    ])("reports the duration of slot $slot as $seconds s", async ({slot, seconds}) => {
      setSlotDurationGauge(metrics, config, slot);
      expect(await sampleValue(metrics, "lodestar_slot_duration_seconds")).toBe(seconds);
    });

    it("initializes the gauge and zero deadline counters", async () => {
      initSlotTimingMetrics(metrics, config, hezeSlot);

      expect(await sampleValue(metrics, "lodestar_slot_duration_seconds")).toBe(10);
      expect(
        await sampleValue(metrics, "lodestar_deadline_missed_total", {
          deadline: "attestation_due",
          task: "block_become_head",
        })
      ).toBe(0);
      expect(
        await sampleValue(metrics, "lodestar_deadline_missed_total", {
          deadline: "next_slot_start",
          task: "prepare_next_slot",
        })
      ).toBe(0);
    });
  });
});
