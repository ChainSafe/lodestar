import {bench, describe} from "@chainsafe/benchmark";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, MIN_EPOCHS_TO_INACTIVITY_PENALTY} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {processInactivityUpdates} from "../../../src/epoch/processInactivityUpdates.js";
import {upgradeStateToFulu} from "../../../src/slot/upgradeStateToFulu.js";
import {upgradeStateToGloas} from "../../../src/slot/upgradeStateToGloas.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generatePerfTestCachedStateElectra, numValidators} from "../../../src/testUtils/util.js";
import {CachedBeaconStateAltair} from "../../../src/types.js";
import {FLAG_ELIGIBLE_ATTESTER, FLAG_UNSLASHED} from "../../../src/util/attesterStatus.js";
import {StateEpoch} from "../types.js";
import {generateBalanceDeltasEpochTransitionCache} from "./utilPhase0.js";

describe("gloas processInactivityUpdates", () => {
  const vc = numValidators;
  const eligibleMissedTargetFlags = FLAG_ELIGIBLE_ATTESTER | FLAG_UNSLASHED;

  bench<StateEpoch, StateEpoch>({
    id: `gloas processInactivityUpdates - ${vc} inactivity leak all eligible missed target`,
    yieldEventLoopAfterEach: true, // So SubTree(s)'s WeakRef can be garbage collected https://github.com/nodejs/node/issues/39902
    before: () => {
      const upgraded = upgradeStateToGloas(
        upgradeStateToFulu(generatePerfTestCachedStateElectra({goBackOneSlot: true}))
      );
      upgraded.commit();
      const state = createCachedBeaconStateTest(
        ssz.gloas.BeaconState.getViewDU(upgraded.node),
        getConfig(ForkName.gloas),
        {skipSyncPubkeys: true}
      );
      state.finalizedCheckpoint.epoch = state.epochCtx.epoch - MIN_EPOCHS_TO_INACTIVITY_PENALTY - 2;
      state.commit();
      const cache = generateBalanceDeltasEpochTransitionCache(state, true, eligibleMissedTargetFlags);
      return {state, cache};
    },
    beforeEach: ({state, cache}) => ({state: state.clone(), cache}),
    fn: ({state, cache}) => processInactivityUpdates(state as CachedBeaconStateAltair, cache),
  });
});
