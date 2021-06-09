import {runBlockTransitionTests} from "./phase0/block/block.perf";
import {runEpochTransitionStepTests} from "./phase0/epoch/epoch.perf";
import {runGetAttestationDeltaTest} from "./phase0/epoch/getAttestationDeltas.perf";
import {runEpochTransitionTests} from "./phase0/slot/slots.perf";
import {runAggregationBitsTest} from "./util/aggregationBits.perf";

// eslint-disable-next-line @typescript-eslint/no-floating-promises
(async function () {
  await runBlockTransitionTests();
  await runEpochTransitionStepTests();
  await runGetAttestationDeltaTest();
  await runEpochTransitionTests();
  await runAggregationBitsTest();
})();
