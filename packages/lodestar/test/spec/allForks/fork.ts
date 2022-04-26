import {join} from "node:path";
import {allForks, phase0, BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {createIChainForkConfig, IChainConfig} from "@chainsafe/lodestar-config";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../util";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState";

export function fork(forkConfig: Partial<IChainConfig>, pre: ForkName, fork: Exclude<ForkName, ForkName.phase0>): void {
  const testConfig = createIChainForkConfig(forkConfig);
  describeDirectorySpecTest<IUpgradeStateCase, BeaconStateAllForks>(
    `${ACTIVE_PRESET}/${fork}/fork/fork`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/fork/fork/pyspec_tests`),
    (testcase) => {
      const preState = createCachedBeaconStateTest(testcase.pre, testConfig);
      return allForks.upgradeStateByFork[fork](preState);
    },
    {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[pre].BeaconState,
        post: ssz[fork].BeaconState,
      },

      timeout: 10000,
      shouldError: (testCase) => testCase.post === undefined,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    }
  );
}

type PostBeaconState = Exclude<BeaconStateAllForks, phase0.BeaconState>;

interface IUpgradeStateCase extends IBaseSpecTest {
  pre: BeaconStateAllForks;
  post: PostBeaconState;
}
