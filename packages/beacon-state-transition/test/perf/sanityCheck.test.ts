import {expect} from "chai";
import {prepareEpochProcessState} from "../../src/allForks";
import {generatePerfTestCachedStateAltair, generatePerfTestCachedStatePhase0, perfStateId} from "./util";

describe("Perf test sanity check", function () {
  this.timeout(60 * 1000);

  const numValidators = 250000;
  const targetStakeYWei = 7;
  const targetStake = BigInt(targetStakeYWei) * BigInt(1) ** BigInt(15);

  before("Ensure perfStateId is correct", () => {
    expect(perfStateId).to.equal(`${numValidators} vs - ${targetStakeYWei}PWei`, "perfStateId has changed");
  });

  it("phase0State validator count is the same", () => {
    const phase0State = generatePerfTestCachedStatePhase0();
    expect(phase0State.validators.length).to.equal(numValidators, "phase0State validator count has changed");
  });

  it("altairState validator count is the same", () => {
    const altairState = generatePerfTestCachedStateAltair();
    expect(altairState.validators.length).to.equal(numValidators, "altairState validator count has changed");
  });

  it("targetStake is in the same range", () => {
    const phase0State = generatePerfTestCachedStatePhase0();
    const epochProcess = prepareEpochProcessState(phase0State);
    expect(epochProcess.prevEpochUnslashedStake.targetStake > targetStake).to.equal(
      true,
      `targetStake too low: ${epochProcess.prevEpochUnslashedStake.targetStake} > ${targetStake}`
    );
  });
});
