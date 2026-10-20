import {describe, expect, it, vi} from "vitest";
import {FAR_FUTURE_EPOCH, ForkName, MAX_EFFECTIVE_BALANCE, SLOTS_PER_EPOCH} from "@lodestar/params";
import {Histogram, LabelsGeneric, MetricsRegister} from "@lodestar/utils";
import {BeaconStateTransitionMetrics, getMetrics} from "../../src/metrics.js";
import {processSlots} from "../../src/stateTransition.js";
import {generateCachedState} from "../utils/state.js";
import {generateValidators} from "../utils/validator.js";

function createFakeRegister(): MetricsRegister {
  const fakeMetric = () => ({
    inc: vi.fn(),
    dec: vi.fn(),
    set: vi.fn(),
    observe: vi.fn(),
    startTimer: vi.fn(() => () => 0),
    reset: vi.fn(),
  });
  return {
    gauge: () => fakeMetric(),
    histogram: <Labels extends LabelsGeneric>() => fakeMetric() as unknown as Histogram<Labels>,
    counter: () => fakeMetric(),
  };
}

function generateActiveState(slot: number) {
  const validators = generateValidators(16, {
    activation: 0,
    exit: FAR_FUTURE_EPOCH,
    withdrawableEpoch: FAR_FUTURE_EPOCH,
    balance: MAX_EFFECTIVE_BALANCE,
  });
  return generateCachedState({slot, validators});
}

function runEpochTransition(metrics: BeaconStateTransitionMetrics, epochTransitionSec: number): void {
  vi.mocked(metrics.epochTransitionTime.startTimer).mockReturnValue(() => epochTransitionSec);
  processSlots(generateActiveState(SLOTS_PER_EPOCH - 1), SLOTS_PER_EPOCH, {}, {metrics});
}

describe("epoch transition slot fraction", () => {
  it("divides the epoch transition timer by the slot duration", () => {
    const metrics = getMetrics(createFakeRegister());
    runEpochTransition(metrics, 2);

    expect(metrics.epochTransitionSlotFraction.observe).toHaveBeenCalledOnce();
    expect(metrics.epochTransitionSlotFraction.observe).toHaveBeenCalledWith(2 / 12);
  });

  it("uses the duration of the fork the transition enters", () => {
    const metrics = getMetrics(createFakeRegister());
    vi.mocked(metrics.epochTransitionTime.startTimer).mockReturnValue(() => 2);
    const state = generateActiveState(SLOTS_PER_EPOCH - 1);
    vi.spyOn(state.config, "getForkName").mockImplementation((slot) =>
      slot >= SLOTS_PER_EPOCH ? ForkName.heze : ForkName.gloas
    );
    vi.spyOn(state.config, "getSlotDurationMs").mockImplementation((fork) => (fork === ForkName.heze ? 10000 : 12000));

    processSlots(state, SLOTS_PER_EPOCH, {}, {metrics});

    expect(metrics.epochTransitionSlotFraction.observe).toHaveBeenCalledWith(2 / 10);
  });

  it("does not observe a fraction on a slot without an epoch transition", () => {
    const metrics = getMetrics(createFakeRegister());
    processSlots(generateActiveState(1), 2, {}, {metrics});

    expect(metrics.epochTransitionSlotFraction.observe).not.toHaveBeenCalled();
  });
});
