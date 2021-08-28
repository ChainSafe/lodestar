import {join} from "path";
import fs from "fs";
import {CachedBeaconState, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {expectEqualBeaconStateAltair, inputTypeSszTreeBacked} from "../util";
import {IAltairStateTestCase, config} from "./util";
import {IBaseSpecTest} from "../type";

/* eslint-disable @typescript-eslint/naming-convention */

/** Describe with which function to run each directory of tests */
const operationFns: Record<string, EpochProcessFn> = {
  attestation: (state, testCase: IBaseSpecTest & {attestation: phase0.Attestation}) => {
    altair.processAttestations(state, [testCase.attestation], {});
  },

  attester_slashing: (state, testCase: IBaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    const verify = !!testCase.meta && !!testCase.meta.blsSetting && testCase.meta.blsSetting === BigInt(1);
    altair.processAttesterSlashing(state, testCase.attester_slashing, {}, verify);
  },

  block_header: (state, testCase: IBaseSpecTest & {block: altair.BeaconBlock}) => {
    allForks.processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, testCase.block);
  },

  deposit: (state, testCase: IBaseSpecTest & {deposit: phase0.Deposit}) => {
    altair.processDeposit(state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: IBaseSpecTest & {proposer_slashing: phase0.ProposerSlashing}) => {
    altair.processProposerSlashing(state, testCase.proposer_slashing, {});
  },

  sync_aggregate: (state, testCase: IBaseSpecTest & {sync_aggregate: altair.SyncAggregate}) => {
    const block = ssz.altair.BeaconBlock.defaultTreeBacked();

    // processSyncAggregate() needs the full block to get the slot
    block.slot = state.slot;
    block.body.syncAggregate = testCase["sync_aggregate"];

    altair.processSyncAggregate(state, block);
  },

  voluntary_exit: (state, testCase: IBaseSpecTest & {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    altair.processVoluntaryExit(state, testCase.voluntary_exit, {});
  },
};
type EpochProcessFn = (state: CachedBeaconState<altair.BeaconState>, testCase: any) => void;

const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/altair/operations`);
for (const testDir of fs.readdirSync(rootDir)) {
  const operationFn = operationFns[testDir];
  if (!operationFn) {
    throw Error(`No operationFn for ${testDir}`);
  }

  describeDirectorySpecTest<IAltairStateTestCase, altair.BeaconState>(
    `${ACTIVE_PRESET}/altair/operations/${testDir}`,
    join(rootDir, `${testDir}/pyspec_tests`),
    (testcase) => {
      const stateTB = (testcase.pre as TreeBacked<altair.BeaconState>).clone();
      const state = allForks.createCachedBeaconState(config, stateTB);
      operationFn(state, testcase);
      return state;
    },
    {
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz.altair.BeaconState,
        post: ssz.altair.BeaconState,
        attestation: ssz.phase0.Attestation,
        attester_slashing: ssz.phase0.AttesterSlashing,
        block: ssz.altair.BeaconBlock,
        deposit: ssz.phase0.Deposit,
        proposer_slashing: ssz.phase0.ProposerSlashing,
        sync_aggregate: ssz.altair.SyncAggregate,
        voluntary_exit: ssz.phase0.SignedVoluntaryExit,
      },
      shouldError: (testCase) => !testCase.post,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}
