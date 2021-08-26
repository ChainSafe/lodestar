import {join} from "path";
import fs from "fs";

import {CachedBeaconState, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {processParticipationRecordUpdates} from "@chainsafe/lodestar-beacon-state-transition/src/phase0/epoch/processParticipationRecordUpdates";
import {altair as altairTypes, ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {expectEqualBeaconStateAltair, inputTypeSszTreeBacked} from "../util";
import {IAltairStateTestCase, config} from "./util";

/** Describe with which function to run each directory of tests */
const epochProcessFns: Record<string, EpochProcessFn> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  effective_balance_updates: allForks.processEffectiveBalanceUpdates,
  eth1_data_reset: allForks.processEth1DataReset,
  historical_roots_update: allForks.processHistoricalRootsUpdate,
  inactivity_updates: altair.processInactivityUpdates as EpochProcessFn,
  justification_and_finalization: allForks.processJustificationAndFinalization,
  participation_flag_updates: altair.processParticipationFlagUpdates as EpochProcessFn,
  participation_record_updates: (processParticipationRecordUpdates as unknown) as EpochProcessFn,
  randao_mixes_reset: allForks.processRandaoMixesReset,
  registry_updates: allForks.processRegistryUpdates,
  rewards_and_penalties: altair.processRewardsAndPenalties as EpochProcessFn,
  slashings: altair.processSlashings as EpochProcessFn,
  slashings_reset: allForks.processSlashingsReset,
  sync_committee_updates: altair.processSyncCommitteeUpdates as EpochProcessFn,
  /* eslint-enable @typescript-eslint/naming-convention */
};
type EpochProcessFn = (state: CachedBeaconState<allForks.BeaconState>, epochProcess: allForks.IEpochProcess) => void;

const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/altair/epoch_processing`);
for (const testDir of fs.readdirSync(rootDir)) {
  const epochProcessFn = epochProcessFns[testDir];
  if (!epochProcessFn) {
    throw Error(`No epochProcessFn for ${testDir}`);
  }

  describeDirectorySpecTest<IAltairStateTestCase, altairTypes.BeaconState>(
    `${ACTIVE_PRESET}/altair/epoch_processing/${testDir}`,
    join(rootDir, `${testDir}/pyspec_tests`),
    (testcase) => {
      const stateTB = (testcase.pre as TreeBacked<allForks.BeaconState>).clone();
      const state = allForks.createCachedBeaconState(config, stateTB);
      const epochProcess = allForks.beforeProcessEpoch(state);
      epochProcessFn(state, epochProcess);
      allForks.afterProcessEpoch(state, epochProcess);
      return state;
    },
    {
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz.altair.BeaconState,
        post: ssz.altair.BeaconState,
      },
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}
