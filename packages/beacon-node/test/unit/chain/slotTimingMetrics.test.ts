import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {PayloadEnvelopeInputSource} from "../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {
  initSlotTimingMetrics,
  observeBlockArrival,
  observeBlockBecomeHead,
  observePayloadImport,
  setSlotDurationGauge,
} from "../../../src/chain/slotTimingMetrics.js";
import {OpSource} from "../../../src/chain/validatorMonitor.js";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
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
    it("skips heads older than an epoch so sync does not distort the population", async () => {
      observeBlockBecomeHead(metrics, config, hezeSlot, SLOTS_PER_EPOCH * 10);

      const fractions = await histogramSamples(metrics, "lodestar_import_block_become_head_slot_fraction");
      expect(fractions.count).toBe(0);
    });

    it.each([
      // ATTESTATION_DUE_BPS_GLOAS=2500 of 12s is 3s, of 10s is 2.5s: the same delay misses only on the 10s head
      {headSlot: gloasSlot, slotDurationSec: 12, missed: 0},
      {headSlot: hezeSlot, slotDurationSec: 10, missed: 1},
    ])(
      "divides by and compares against the head slot's fork (slot $headSlot, missed=$missed)",
      async ({headSlot, slotDurationSec, missed}) => {
        observeBlockBecomeHead(metrics, config, headSlot, 2.6);

        const seconds = await histogramSamples(metrics, "lodestar_gossip_block_elapsed_time_till_become_head");
        const fractions = await histogramSamples(metrics, "lodestar_import_block_become_head_slot_fraction");
        expect(seconds).toEqual({count: 1, sum: 2.6});
        expect(fractions.count).toBe(1);
        expect(fractions.sum).toBeCloseTo(2.6 / slotDurationSec, 10);
        expect(await sampleValue(metrics, "lodestar_deadline_missed_total", {task: "block_become_head"})).toBe(
          missed || undefined
        );
      }
    );
  });

  describe("observePayloadImport", () => {
    const FRACTION_NAME = "lodestar_import_payload_elapsed_slot_fraction";
    const MISSED_NAME = "lodestar_import_payload_deadline_missed_total";
    const BEYOND_NAME = "lodestar_import_payload_beyond_window_total";

    function observe(opts: {
      slot: number;
      currentSlot: number;
      delaySec: number;
      status?: ExecutionPayloadStatus.VALID | ExecutionPayloadStatus.SYNCING;
    }): void {
      observePayloadImport(metrics, config, {
        source: PayloadEnvelopeInputSource.gossip,
        status: ExecutionPayloadStatus.VALID,
        ...opts,
      });
    }

    it("observes 2s of a 10s payload slot as 0.2 next to the seconds histogram", async () => {
      observe({slot: hezeSlot, currentSlot: hezeSlot, delaySec: 2});

      const seconds = await histogramSamples(metrics, "lodestar_import_payload_elapsed_time_till_imported_seconds", {
        source: PayloadEnvelopeInputSource.gossip,
      });
      const fractions = await histogramSamples(metrics, FRACTION_NAME, {status: ExecutionPayloadStatus.VALID});
      expect(seconds).toEqual({count: 1, sum: 2});
      expect(fractions.count).toBe(1);
      expect(fractions.sum).toBeCloseTo(0.2, 10);
    });

    it.each([
      {name: "current slot", slot: hezeSlot, sampled: 1, beyond: 0},
      {name: "previous slot", slot: hezeSlot - 1, sampled: 1, beyond: 0},
      {name: "older slot", slot: hezeSlot - 2, sampled: 0, beyond: 1},
      {name: "future slot", slot: hezeSlot + 1, sampled: 0, beyond: 0},
    ])("samples only near-current imports: $name", async ({slot, sampled, beyond}) => {
      observe({slot, currentSlot: hezeSlot, delaySec: 1});

      const seconds = await histogramSamples(metrics, "lodestar_import_payload_elapsed_time_till_imported_seconds", {
        source: PayloadEnvelopeInputSource.gossip,
      });
      expect(seconds.count).toBe(1);
      expect((await histogramSamples(metrics, FRACTION_NAME, {status: ExecutionPayloadStatus.VALID})).count).toBe(
        sampled
      );
      expect(await sampleValue(metrics, BEYOND_NAME)).toBe(beyond);
    });

    it("keeps validated and optimistic imports distinguishable", async () => {
      observe({slot: hezeSlot, currentSlot: hezeSlot, delaySec: 1, status: ExecutionPayloadStatus.VALID});
      observe({slot: hezeSlot, currentSlot: hezeSlot, delaySec: 1, status: ExecutionPayloadStatus.SYNCING});
      observe({slot: hezeSlot, currentSlot: hezeSlot, delaySec: 1, status: ExecutionPayloadStatus.SYNCING});

      expect((await histogramSamples(metrics, FRACTION_NAME, {status: ExecutionPayloadStatus.VALID})).count).toBe(1);
      expect((await histogramSamples(metrics, FRACTION_NAME, {status: ExecutionPayloadStatus.SYNCING})).count).toBe(2);
    });

    it.each([
      // PAYLOAD_DUE_BPS=5000 of 12s is exactly 6s, of 10s is exactly 5s
      {slot: gloasSlot, delaySec: 6, missed: undefined},
      {slot: hezeSlot, delaySec: 5.001, missed: 1},
    ])(
      "counts a miss only past the payload due point of the payload slot (slot $slot, $delaySec s)",
      async ({slot, delaySec, missed}) => {
        observe({slot, currentSlot: slot, delaySec});

        expect((await histogramSamples(metrics, FRACTION_NAME, {status: ExecutionPayloadStatus.VALID})).count).toBe(1);
        expect(await sampleValue(metrics, MISSED_NAME, {status: ExecutionPayloadStatus.VALID})).toBe(missed);
      }
    );
  });

  describe("slot duration gauge", () => {
    it.each([
      {slot: -1, seconds: 12},
      {slot: hezeSlot, seconds: 10},
    ])("reports the duration of slot $slot as $seconds s", async ({slot, seconds}) => {
      setSlotDurationGauge(metrics, config, slot);
      expect(await sampleValue(metrics, "lodestar_slot_duration_seconds")).toBe(seconds);
    });

    it("initializes the gauge and zero deadline counters", async () => {
      initSlotTimingMetrics(metrics, config, hezeSlot);

      expect(await sampleValue(metrics, "lodestar_slot_duration_seconds")).toBe(10);
      for (const task of ["block_become_head", "prepare_next_slot", "prepare_next_slot_completion"]) {
        expect(await sampleValue(metrics, "lodestar_deadline_missed_total", {task}), `missing zero for ${task}`).toBe(
          0
        );
      }
      expect(await sampleValue(metrics, "lodestar_prepare_next_slot_ptc_eligible_completions_total")).toBe(0);
      for (const status of [
        ExecutionPayloadStatus.VALID,
        ExecutionPayloadStatus.SYNCING,
        ExecutionPayloadStatus.ACCEPTED,
      ]) {
        expect(
          await sampleValue(metrics, "lodestar_import_payload_deadline_missed_total", {status}),
          `missing zero for ${status}`
        ).toBe(0);
      }
      expect(await sampleValue(metrics, "lodestar_import_payload_beyond_window_total")).toBe(0);
    });
  });
});
