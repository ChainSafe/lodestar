import {join} from "path";
import fs from "fs";
import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest} from "@chainsafe/lodestar-spec-test-util";
import {ssz} from "@chainsafe/lodestar-types";
import {TreeBacked} from "@chainsafe/ssz";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {expectEqualBeaconStateAltair, inputTypeSszTreeBacked} from "../util";
import {IPhase0StateTestCase, config} from "./util";
import {IBaseSpecTest} from "../type";

/* eslint-disable @typescript-eslint/naming-convention */

/** Describe with which function to run each directory of tests */
const operationFns: Record<string, EpochProcessFn> = {
  attestation: (state, testCase: IBaseSpecTest & {attestation: phase0.Attestation}) => {
    phase0.processAttestations(state, [testCase.attestation], {});
  },

  attester_slashing: (state, testCase: IBaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    const verify = !!testCase.meta && !!testCase.meta.blsSetting && testCase.meta.blsSetting === BigInt(1);
    phase0.processAttesterSlashing(state, testCase.attester_slashing, {}, verify);
  },

  block_header: (state, testCase: IBaseSpecTest & {block: phase0.BeaconBlock}) => {
    allForks.processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, testCase.block);
  },

  deposit: (state, testCase: IBaseSpecTest & {deposit: phase0.Deposit}) => {
    phase0.processDeposit(state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: IBaseSpecTest & {proposer_slashing: phase0.ProposerSlashing}) => {
    phase0.processProposerSlashing(state, testCase.proposer_slashing, {});
  },

  voluntary_exit: (state, testCase: IBaseSpecTest & {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    phase0.processVoluntaryExit(state, testCase.voluntary_exit, {});
  },
};
type EpochProcessFn = (state: CachedBeaconState<phase0.BeaconState>, testCase: any) => void;

const rootDir = join(SPEC_TEST_LOCATION, `tests/${ACTIVE_PRESET}/phase0/operations`);
for (const testDir of fs.readdirSync(rootDir)) {
  const operationFn = operationFns[testDir];
  if (!operationFn) {
    throw Error(`No operationFn for ${testDir}`);
  }

  describeDirectorySpecTest<IPhase0StateTestCase, phase0.BeaconState>(
    `${ACTIVE_PRESET}/phase0/operations/${testDir}`,
    join(rootDir, `${testDir}/pyspec_tests`),
    (testcase) => {
      const stateTB = (testcase.pre as TreeBacked<phase0.BeaconState>).clone();
      const state = allForks.createCachedBeaconState(config, stateTB);
      const epochProcess = allForks.beforeProcessEpoch(state);
      operationFn(state, epochProcess);
      return state;
    },
    {
      inputTypes: inputTypeSszTreeBacked,
      sszTypes: {
        pre: ssz.phase0.BeaconState,
        post: ssz.phase0.BeaconState,
        attestation: ssz.phase0.Attestation,
        attester_slashing: ssz.phase0.AttesterSlashing,
        block: ssz.phase0.BeaconBlock,
        deposit: ssz.phase0.Deposit,
        proposer_slashing: ssz.phase0.ProposerSlashing,
        voluntary_exit: ssz.phase0.SignedVoluntaryExit,
      },
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconStateAltair(expected, actual);
      },
    }
  );
}
