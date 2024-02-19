import path from "node:path";
import {
  BeaconStateAllForks,
  CachedBeaconStateBellatrix,
  CachedBeaconStateAltair,
  CachedBeaconStatePhase0,
  CachedBeaconStateCapella,
  CachedBeaconStateDeneb,
} from "@lodestar/state-transition";
import * as slotFns from "@lodestar/state-transition/slot";
import {phase0, ssz} from "@lodestar/types";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";
import {createChainForkConfig, ChainForkConfig} from "@lodestar/config";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

const fork: TestRunnerFn<ForkStateCase, BeaconStateAllForks> = (forkNext) => {
  const config = createChainForkConfig({});
  const forkPrev = getPreviousFork(config, forkNext);

  return {
    testFunction: (testcase) => {
      const preState = createCachedBeaconStateTest(testcase.pre, config);

      switch (forkNext) {
        case ForkName.phase0:
          throw Error("fork phase0 not supported");
        case ForkName.altair:
          return slotFns.upgradeStateToAltair(preState as CachedBeaconStatePhase0);
        case ForkName.bellatrix:
          return slotFns.upgradeStateToBellatrix(preState as CachedBeaconStateAltair);
        case ForkName.capella:
          return slotFns.upgradeStateToCapella(preState as CachedBeaconStateBellatrix);
        case ForkName.deneb:
          return slotFns.upgradeStateToDeneb(preState as CachedBeaconStateCapella);
        case ForkName.electra:
          return slotFns.upgradeStateToElectra(preState as CachedBeaconStateDeneb);
      }
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[forkPrev].BeaconState,
        post: ssz[forkNext].BeaconState,
      },

      timeout: 10000,
      shouldError: (testCase) => testCase.post === undefined,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(forkNext, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type ForkStateCase = {
  meta?: any;
  pre: BeaconStateAllForks;
  post: Exclude<BeaconStateAllForks, phase0.BeaconState>;
};

export function getPreviousFork(config: ChainForkConfig, fork: ForkName): ForkName {
  // Find the previous fork
  const forkIndex = config.forksAscendingEpochOrder.findIndex((f) => f.name === fork);
  if (forkIndex < 1) {
    throw Error(`Fork ${fork} not found`);
  }
  return config.forksAscendingEpochOrder[forkIndex - 1].name;
}

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  fork: {type: RunnerType.default, fn: fork},
});
