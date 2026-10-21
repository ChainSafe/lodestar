import {Mock, MockInstance, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {config} from "@lodestar/config/default";
import {ProtoBlock} from "@lodestar/fork-choice";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {IChainOptions} from "../../../src/chain/options.js";
import {PrepareNextSlotScheduler} from "../../../src/chain/prepareNextSlot.js";
import {Metrics} from "../../../src/metrics/index.js";
import {MockedLogger, getMockedLogger} from "../../mocks/loggerMock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {generateCachedBellatrixState, zeroProtoBlock} from "../../utils/state.js";
import {createMetricsTest} from "../metrics/utils.js";

const MARGIN_NAME = "lodestar_prepare_next_slot_lead_margin_slot_fraction";
const DEADLINE_NAME = "lodestar_deadline_missed_total";

type MetricValue = {value: number; labels: Record<string, string | number>; metricName?: string};

async function getValues(metrics: Metrics, name: string): Promise<MetricValue[]> {
  const metric = metrics.register.getSingleMetric(name);
  if (!metric) throw Error(`metric ${name} not registered`);
  const {values} = await metric.get();
  return values as MetricValue[];
}

async function marginSamples(metrics: Metrics, slotPosition: string): Promise<{count: number; sum: number}> {
  const values = await getValues(metrics, MARGIN_NAME);
  const count =
    values.find((v) => v.metricName === `${MARGIN_NAME}_count` && v.labels.slot_position === slotPosition)?.value ?? 0;
  const sum =
    values.find((v) => v.metricName === `${MARGIN_NAME}_sum` && v.labels.slot_position === slotPosition)?.value ?? 0;
  return {count, sum};
}

async function bucketCount(metrics: Metrics, slotPosition: string, le: number): Promise<number> {
  const values = await getValues(metrics, MARGIN_NAME);
  return (
    values.find(
      (v) => v.metricName === `${MARGIN_NAME}_bucket` && v.labels.slot_position === slotPosition && v.labels.le === le
    )?.value ?? 0
  );
}

async function deadlineMissed(metrics: Metrics, task = "prepare_next_slot"): Promise<number | undefined> {
  const values = await getValues(metrics, DEADLINE_NAME);
  return values.find((v) => v.labels.task === task)?.value;
}

async function ptcEligibleCompletions(metrics: Metrics): Promise<number | undefined> {
  const values = await getValues(metrics, "lodestar_prepare_next_slot_ptc_eligible_completions_total");
  return values[0]?.value;
}

describe("PrepareNextSlot scheduler metrics", () => {
  const abortController = new AbortController();
  const epochEndSlot = SLOTS_PER_EPOCH - 1;

  let chainStub: MockedBeaconChain;
  let scheduler: PrepareNextSlotScheduler;
  let loggerStub: MockedLogger;
  let metrics: Metrics;
  let getForkStub: MockInstance<(_: number) => ForkName>;
  let msFromSlot: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    chainStub = getMockedBeaconChain({clock: "fake", genesisTime: 0});
    loggerStub = getMockedLogger();
    metrics = createMetricsTest();
    getForkStub = vi.spyOn(config, "getForkName");
    msFromSlot = chainStub.clock.msFromSlot as Mock;
    vi.spyOn(chainStub, "opts", "get").mockReturnValue({} as IChainOptions);
    vi.spyOn(chainStub.regen, "getBlockSlotState").mockResolvedValue(
      new BeaconStateView(generateCachedBellatrixState())
    );
    vi.spyOn(chainStub.regen, "updatePreComputedCheckpoint").mockReturnValue(0);
    chainStub.getHeadState.mockReturnValue(new BeaconStateView(generateCachedBellatrixState()));
    chainStub.forkChoice.getFinalizedBlock.mockReturnValue({} as ProtoBlock);
    chainStub.forkChoice.getConfirmedBlock.mockReturnValue(null);
    scheduler = new PrepareNextSlotScheduler(chainStub, config, metrics, loggerStub, abortController.signal);
  });

  afterEach(() => {
    metrics.register.clear();
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** Run the pre-bellatrix epoch-end flow, which only regens and hashes the next epoch state */
  async function runEpochEnd(currentDurationMs: number, nextDurationMs: number): Promise<void> {
    getForkStub.mockImplementation((slot) => (slot <= epochEndSlot ? ForkName.phase0 : ForkName.altair));
    vi.spyOn(config, "getSlotDurationMs").mockImplementation((fork) =>
      fork === ForkName.phase0 ? currentDurationMs : nextDurationMs
    );
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: epochEndSlot - 1} as ProtoBlock);
    await Promise.all([scheduler.prepareForNextSlot(epochEndSlot), vi.advanceTimersByTimeAsync(currentDurationMs)]);
    expect(loggerStub.error).not.toHaveBeenCalled();
  }

  it("observes the remaining fraction of the scheduling slot, not the next slot", async () => {
    // 3s left before the next slot while the scheduling slot is 12s and the next slot is 10s
    msFromSlot.mockReturnValue(-3000);
    await runEpochEnd(12000, 10000);

    const samples = await marginSamples(metrics, "epoch_end");
    expect(samples.count).toBe(1);
    expect(samples.sum).toBeCloseTo(0.25, 10);
    expect(await marginSamples(metrics, "other")).toEqual({count: 0, sum: 0});
    expect(await deadlineMissed(metrics)).toBeUndefined();
  });

  it("keeps late completions signed and in distinct negative buckets", async () => {
    msFromSlot.mockReturnValueOnce(600);
    await runEpochEnd(12000, 12000);
    msFromSlot.mockReturnValueOnce(2500);
    await runEpochEnd(12000, 12000);

    const samples = await marginSamples(metrics, "epoch_end");
    expect(samples.count).toBe(2);
    expect(samples.sum).toBeCloseTo(-600 / 12000 - 2500 / 12000, 10);
    // -0.05 first lands in the -0.042 bucket, -0.208 first lands in the -0.167 bucket
    expect(await bucketCount(metrics, "epoch_end", -0.25)).toBe(0);
    expect(await bucketCount(metrics, "epoch_end", -0.167)).toBe(1);
    expect(await bucketCount(metrics, "epoch_end", -0.042)).toBe(2);
    expect(await deadlineMissed(metrics)).toBe(2);
  });

  describe("PTC due completions", () => {
    // PAYLOAD_ATTESTATION_DUE_BPS=7500 of the 12s default slot
    const ptcDueMs = 9000;

    /** Post-fulu flow with no proposer, built on bellatrix fixtures; `currentFork`/`nextFork` drive the fork guards */
    async function run(clockSlot: number, currentFork: ForkName, nextFork: ForkName, msIntoSlot: number) {
      const prepareSlot = clockSlot + 1;
      getForkStub.mockImplementation((slot) => (slot <= clockSlot ? currentFork : nextFork));
      const headState = generateCachedBellatrixState();
      vi.spyOn(headState.epochCtx, "getBeaconProposer").mockReturnValue(0);
      chainStub.getHeadState.mockReturnValue(new BeaconStateView(headState));
      const headBlock = {...zeroProtoBlock, slot: clockSlot - 1} as ProtoBlock;
      chainStub.recomputeForkChoiceHead.mockReturnValue(headBlock);
      chainStub.predictProposerHead.mockReturnValue(headBlock);
      msFromSlot.mockImplementation((slot: number) => (slot === prepareSlot ? msIntoSlot - 12000 : msIntoSlot));

      await Promise.all([scheduler.prepareForNextSlot(clockSlot), vi.advanceTimersByTimeAsync(12000)]);
      expect(loggerStub.error).not.toHaveBeenCalled();
    }

    it("counts an epoch-end gloas completion before the PTC due point as eligible and not missed", async () => {
      await run(epochEndSlot, ForkName.gloas, ForkName.gloas, ptcDueMs - 1);

      expect(await ptcEligibleCompletions(metrics)).toBe(1);
      expect(await deadlineMissed(metrics, "prepare_next_slot_completion")).toBeUndefined();
    });

    it("counts a completion after the PTC due point of the scheduling slot as missed", async () => {
      await run(epochEndSlot, ForkName.gloas, ForkName.gloas, ptcDueMs + 1);

      expect(await ptcEligibleCompletions(metrics)).toBe(1);
      expect(await deadlineMissed(metrics, "prepare_next_slot_completion")).toBe(1);
    });

    it("excludes the epoch-end preparation of the last pre-gloas epoch", async () => {
      await run(epochEndSlot, ForkName.fulu, ForkName.gloas, ptcDueMs + 1);

      expect(await ptcEligibleCompletions(metrics)).toBe(0);
      expect(await deadlineMissed(metrics, "prepare_next_slot_completion")).toBeUndefined();
    });
  });

  it("labels a non epoch-end scheduling slot as other", async () => {
    const clockSlot = SLOTS_PER_EPOCH - 3;
    getForkStub.mockReturnValue(ForkName.bellatrix);
    chainStub.recomputeForkChoiceHead.mockReturnValue({...zeroProtoBlock, slot: clockSlot - 1} as ProtoBlock);
    msFromSlot.mockReturnValue(-4000);

    await Promise.all([scheduler.prepareForNextSlot(clockSlot), vi.advanceTimersByTimeAsync(config.SLOT_DURATION_MS)]);

    expect(loggerStub.error).not.toHaveBeenCalled();
    const samples = await marginSamples(metrics, "other");
    expect(samples.count).toBe(1);
    expect(samples.sum).toBeCloseTo(4000 / config.SLOT_DURATION_MS, 10);
    expect(await marginSamples(metrics, "epoch_end")).toEqual({count: 0, sum: 0});
  });
});
