import {BenchmarkRunner} from "@chainsafe/lodestar-utils";
import {allForks, phase0} from "../../../../src";
import {generatePerfTestCachedBeaconState, initBLS} from "../../util";

export const runProcessRewardsAndPenalties = async (): Promise<void> => {
  const runner = new BenchmarkRunner("processRewardsAndPenalties", {
    maxMs: 10 * 60 * 1000,
    runs: 100,
  });
  await initBLS();
  const state = generatePerfTestCachedBeaconState({goBackOneSlot: true});
  const epochProcess = allForks.prepareEpochProcessState(state);
  await runner.run({
    id: "processRewardsAndPenalties",
    run: () => {
      phase0.processRewardsAndPenalties(state, epochProcess);
    },
  });
  runner.done();
};
