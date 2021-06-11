import {runBlockTransitionTests} from "./phase0/block/block.perf";
import {runEpochTransitionStepTests} from "./phase0/epoch/epoch.perf";
import {runGetAttestationDeltaTest} from "./phase0/epoch/getAttestationDeltas.perf";
import {runEpochTransitionTests} from "./phase0/slot/slots.perf";
import {runAggregationBitsTest} from "./util/aggregationBits.perf";

async function runAll(): Promise<void> {
  await runBlockTransitionTests();
  await runEpochTransitionStepTests();
  await runGetAttestationDeltaTest();
  await runEpochTransitionTests();
  await runAggregationBitsTest();
}

// Must catch an exit 1 or the script will succeed
runAll().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
