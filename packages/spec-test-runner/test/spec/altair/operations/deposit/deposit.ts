import {TreeBacked} from "@chainsafe/ssz";
import {allForks, altair, CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";
import {createIChainForkConfig} from "@chainsafe/lodestar-config";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {join} from "path";
import {SPEC_TEST_LOCATION} from "../../../../utils/specTestCases";
import {IProcessDepositTestCase} from "./type";
import {expectEqualBeaconStateAltair} from "../../../util";
import {ssz} from "@chainsafe/lodestar-types";
import {PresetName} from "@chainsafe/lodestar-params";

export function runDeposit(presetName: PresetName): void {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const config = createIChainForkConfig({ALTAIR_FORK_EPOCH: 0});

  describeDirectorySpecTest<IProcessDepositTestCase, altair.BeaconState>(
    `process deposit ${presetName}`,
    join(SPEC_TEST_LOCATION, `/tests/${presetName}/altair/operations/deposit/pyspec_tests`),
    (testcase) => {
      const wrappedState = allForks.createCachedBeaconState<altair.BeaconState>(
        config,
        testcase.pre as TreeBacked<altair.BeaconState>
      ) as CachedBeaconState<altair.BeaconState>;
      altair.processDeposit(wrappedState, testcase.deposit);
      return wrappedState;
    },
    {
      inputTypes: {
        pre: {
          type: InputType.SSZ_SNAPPY,
          treeBacked: true,
        },
        post: {
          type: InputType.SSZ_SNAPPY,
          treeBacked: true,
        },
      },
      sszTypes: {
        pre: ssz.altair.BeaconState,
        post: ssz.altair.BeaconState,
        deposit: ssz.phase0.Deposit,
      },
      timeout: 10000,
      shouldError: (testCase) => !testCase.post,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}
