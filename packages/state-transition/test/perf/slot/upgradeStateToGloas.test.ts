import {bench, describe, setBenchOpts} from "@chainsafe/benchmark";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateFulu} from "../../../src/index.js";
import {upgradeStateToGloas} from "../../../src/slot/upgradeStateToGloas.js";
import {generateBuilderPendingDeposits, generatePerfTestCachedStateFulu} from "../../../src/testUtils/util.js";
import {beforeValue} from "../../utils/beforeValueBenchmark.js";

// End-to-end benchmark for `upgradeStateToGloas` onboarding builders at the Gloas fork.
// Exercises the real `onboardBuildersFromPendingDeposits` -> `applyDepositForBuilder` ->
// `isValidDepositSignature` (BLS verify, O(N)) -> `addBuilderToRegistry` (linear registry
// scan, O(N^2)) path. See the `// TODO GLOAS: handle 20k 1ETH deposits` note in
// `upgradeStateToGloas.ts`.

const VALIDATOR_COUNT = 16384;
const BUILDER_COUNTS = [5000, 10000, 20000, 30000];
const MAX_BUILDERS = Math.max(...BUILDER_COUNTS);

describe("upgradeStateToGloas - onboard builders", () => {
  // O(N^2) registry build + N BLS verifications is slow and noisy: few runs, no regression gate.
  setBenchOpts({minRuns: 3, yieldEventLoopAfterEach: true, noThreshold: true});

  // Sign MAX_BUILDERS deposits and build the Fulu base state once; slice prefixes per size.
  const shared = beforeValue(() => {
    const baseState = generatePerfTestCachedStateFulu({vc: VALIDATOR_COUNT});
    const deposits = generateBuilderPendingDeposits(baseState.config, MAX_BUILDERS, VALIDATOR_COUNT);
    return {baseState, deposits};
  }, 300_000);

  for (const builderCount of BUILDER_COUNTS) {
    bench<CachedBeaconStateFulu, CachedBeaconStateFulu>({
      id: `upgradeStateToGloas - onboard ${builderCount} builders`,
      before: () => {
        const state = shared.value.baseState.clone();
        const pendingDeposits = ssz.electra.PendingDeposits.defaultViewDU();
        for (let i = 0; i < builderCount; i++) {
          pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(shared.value.deposits[i]));
        }
        state.pendingDeposits = pendingDeposits;
        state.commit();
        state.hashTreeRoot();
        return state;
      },
      beforeEach: (state) => state.clone(),
      fn: (state) => {
        const gloasState = upgradeStateToGloas(state);
        // In-benchmark guard: every deposit must actually be onboarded as a builder.
        if (gloasState.builders.length !== builderCount) {
          throw Error(`expected ${builderCount} builders onboarded, got ${gloasState.builders.length}`);
        }
      },
    });
  }
});
