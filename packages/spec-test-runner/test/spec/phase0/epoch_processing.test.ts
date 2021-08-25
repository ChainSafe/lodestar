import {join} from "path";
import fs from "fs";

import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {processParticipationRecordUpdates} from "@chainsafe/lodestar-beacon-state-transition/src/phase0/epoch/processParticipationRecordUpdates";
import {phase0 as phase0Types, ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {expectEqualBeaconStateAltair} from "../util";
import {IPhase0StateTestCase, config} from "./util";

/** Describe with which function to run each directory of tests */
const epochProcessFns: Record<string, EpochProcessFn> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  effective_balance_updates: allForks.processEffectiveBalanceUpdates,
  eth1_data_reset: allForks.processEth1DataReset,
  historical_roots_update: allForks.processHistoricalRootsUpdate,
  justification_and_finalization: allForks.processJustificationAndFinalization,
  participation_record_updates: (processParticipationRecordUpdates as unknown) as EpochProcessFn,
  randao_mixes_reset: allForks.processRandaoMixesReset,
  registry_updates: allForks.processRegistryUpdates,
  rewards_and_penalties: phase0.processRewardsAndPenalties as EpochProcessFn,
  slashings: phase0.processSlashings as EpochProcessFn,
  slashings_reset: allForks.processSlashingsReset,
  /* eslint-enable @typescript-eslint/naming-convention */
};
type EpochProcessFn = (state: CachedBeaconState<allForks.BeaconState>, epochProcess: allForks.IEpochProcess) => void;

const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/phase0/epoch_processing`);
for (const testDir of fs.readdirSync(rootDir)) {
  const epochProcessFn = epochProcessFns[testDir];
  if (!epochProcessFn) {
    throw Error(`No epochProcessFn for ${testDir}`);
  }

  describeDirectorySpecTest<IPhase0StateTestCase, phase0Types.BeaconState>(
    `${ACTIVE_PRESET}/phase0/epoch_processing/${testDir}`,
    join(rootDir, `${testDir}/pyspec_tests`),
    (testcase) => {
      const stateTB = (testcase.pre as TreeBacked<allForks.BeaconState>).clone();
      const state = allForks.createCachedBeaconState(config, stateTB);
      const epochProcess = allForks.beforeProcessEpoch(state);
      epochProcessFn(state, epochProcess);
      return state;
    },
    {
      inputTypes: {
        pre: {type: InputType.SSZ_SNAPPY, treeBacked: true},
        post: {type: InputType.SSZ_SNAPPY, treeBacked: true},
      },
      sszTypes: {
        pre: ssz.phase0.BeaconState,
        post: ssz.phase0.BeaconState,
      },
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}
