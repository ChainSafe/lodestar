import {runBlockTransitionTests} from "./phase0/block/block.perf";
import {runEpochTransitionStepTests} from "./phase0/epoch/epoch.perf";
import {runGetAttestationDeltaTest} from "./phase0/epoch/getAttestationDeltas.perf";
import {runProcessRewardsAndPenalties} from "./phase0/epoch/processRewardsAndPenalties.perf";
import {runEpochTransitionTests} from "./phase0/slot/slots.perf";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function () {
  await runBlockTransitionTests();
  await runEpochTransitionStepTests();
  await runGetAttestationDeltaTest();
  await runProcessRewardsAndPenalties();
  await runEpochTransitionTests();
})();
