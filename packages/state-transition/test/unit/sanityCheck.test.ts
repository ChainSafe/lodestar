import {ACTIVE_PRESET, EFFECTIVE_BALANCE_INCREMENT, PresetName} from "@lodestar/params";
import {beforeAll, describe, expect, it, vi} from "vitest";
import {beforeProcessEpoch} from "../../src/index.js";
import {generatePerfTestCachedStateAltair, generatePerfTestCachedStatePhase0, perfStateId} from "../perf/util.js";

describe("Perf test sanity check", () => {
  vi.setConfig({testTimeout: 90 * 1000});

  if (ACTIVE_PRESET !== PresetName.mainnet) {
    throw Error(`ACTIVE_PRESET '${ACTIVE_PRESET}' must be mainnet`);
  }

  const numValidators = 250000;
  const targetStakeYWei = 7;
  const targetStake = BigInt(targetStakeYWei) * BigInt(1) ** BigInt(15);

  beforeAll(() => {
    expect(perfStateId).toEqualWithMessage(`${numValidators} vs - ${targetStakeYWei}PWei`, "perfStateId has changed");
  });

  it("phase0State validator count is the same", () => {
    const phase0State = generatePerfTestCachedStatePhase0();
    expect(phase0State.validators.length).toEqualWithMessage(numValidators, "phase0State validator count has changed");
  });

  it("altairState validator count is the same", () => {
    const altairState = generatePerfTestCachedStateAltair();
    expect(altairState.validators.length).toEqualWithMessage(numValidators, "altairState validator count has changed");
  });

  it("targetStake is in the same range", () => {
    const phase0State = generatePerfTestCachedStatePhase0();
    const cache = beforeProcessEpoch(phase0State);
    expect(
      BigInt(cache.prevEpochUnslashedStake.targetStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT) > targetStake
    ).toEqualWithMessage(
      true,
      `targetStake too low: ${
        BigInt(cache.prevEpochUnslashedStake.targetStakeByIncrement) * BigInt(EFFECTIVE_BALANCE_INCREMENT)
      } > ${targetStake}`
    );
  });
});
