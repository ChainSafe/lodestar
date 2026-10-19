import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {computeBaseRewardPerIncrement} from "../../../src/util/altair.js";
import {getGloasChurnLimits} from "../../../src/util/validator.js";

describe("slot duration scaling with heze at genesis", () => {
  // 10M increments make sqrt(total active balance) exact so the halving is exact too
  const totalActiveBalanceIncrements = 10_000_000;
  const hezeMidChain = createChainForkConfig({
    SLOT_DURATION_MS: 12000,
    HEZE_FORK_EPOCH: 1,
    SLOT_DURATION_MS_HEZE: 6000,
  });
  const hezeAtGenesis = createChainForkConfig({
    SLOT_DURATION_MS: 12000,
    HEZE_FORK_EPOCH: 0,
    SLOT_DURATION_MS_HEZE: 6000,
  });
  const unchanged = createChainForkConfig({SLOT_DURATION_MS: 12000, HEZE_FORK_EPOCH: 0, SLOT_DURATION_MS_HEZE: 12000});

  it("scales the base reward relative to SLOT_DURATION_MS", () => {
    const scaled = computeBaseRewardPerIncrement(hezeMidChain, 1, totalActiveBalanceIncrements);
    expect(computeBaseRewardPerIncrement(hezeAtGenesis, 0, totalActiveBalanceIncrements)).toBe(scaled);
    expect(computeBaseRewardPerIncrement(unchanged, 0, totalActiveBalanceIncrements)).toBe(2 * scaled);
  });

  it("scales the churn limits relative to SLOT_DURATION_MS", () => {
    const scaled = getGloasChurnLimits(hezeMidChain, 1, totalActiveBalanceIncrements);
    expect(getGloasChurnLimits(hezeAtGenesis, 0, totalActiveBalanceIncrements)).toEqual(scaled);
    expect(getGloasChurnLimits(unchanged, 0, totalActiveBalanceIncrements)).not.toEqual(scaled);
  });
});
