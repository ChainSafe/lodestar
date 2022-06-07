import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
} from "@chainsafe/lodestar-beacon-state-transition";
import * as blockFns from "@chainsafe/lodestar-beacon-state-transition/block";
import {ssz, phase0, altair, bellatrix} from "@chainsafe/lodestar-types";
import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../utils/getConfig.js";
import {BaseSpecTest, shouldVerify, TestRunnerFn} from "../utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention */

// Define above to re-use in sync_aggregate and sync_aggregate_random
const sync_aggregate: BlockProcessFn<CachedBeaconStateAllForks> = (
  state,
  testCase: {sync_aggregate: altair.SyncAggregate}
) => {
  const block = ssz.altair.BeaconBlock.defaultValue();

  // processSyncAggregate() needs the full block to get the slot
  block.slot = state.slot;
  block.body.syncAggregate = ssz.altair.SyncAggregate.toViewDU(testCase["sync_aggregate"]);

  blockFns.processSyncAggregate(state, block);
};

const operationFns: Record<string, BlockProcessFn<CachedBeaconStateAllForks>> = {
  attestation: (state, testCase: {attestation: phase0.Attestation}) => {
    const fork = state.config.getForkSeq(state.slot);
    blockFns.processAttestations(fork, state, [testCase.attestation]);
  },

  attester_slashing: (state, testCase: BaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    const fork = state.config.getForkSeq(state.slot);
    blockFns.processAttesterSlashing(fork, state, testCase.attester_slashing, shouldVerify(testCase));
  },

  block_header: (state, testCase: {block: phase0.BeaconBlock}) => {
    blockFns.processBlockHeader(state, testCase.block);
  },

  deposit: (state, testCase: {deposit: phase0.Deposit}) => {
    const fork = state.config.getForkSeq(state.slot);
    blockFns.processDeposit(fork, state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: {proposer_slashing: phase0.ProposerSlashing}) => {
    const fork = state.config.getForkSeq(state.slot);
    blockFns.processProposerSlashing(fork, state, testCase.proposer_slashing);
  },

  sync_aggregate,
  sync_aggregate_random: sync_aggregate,

  voluntary_exit: (state, testCase: {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    blockFns.processVoluntaryExit(state, testCase.voluntary_exit);
  },

  execution_payload: (
    state,
    testCase: {execution_payload: bellatrix.ExecutionPayload; execution: {execution_valid: boolean}}
  ) => {
    blockFns.processExecutionPayload(
      (state as CachedBeaconStateAllForks) as CachedBeaconStateBellatrix,
      testCase.execution_payload,
      {notifyNewPayload: () => testCase.execution.execution_valid}
    );
  },
};

export type BlockProcessFn<T extends CachedBeaconStateAllForks> = (state: T, testCase: any) => void;

export type OperationsTestCase = {
  meta?: {bls_setting?: bigint};
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
  execution: {execution_valid: boolean};
};

export const operations: TestRunnerFn<OperationsTestCase, BeaconStateAllForks> = (fork, testName) => {
  const operationFn = operationFns[testName];
  if (operationFn === undefined) {
    throw Error(`No operationFn for ${testName}`);
  }

  return {
    testFunction: (testcase) => {
      const state = testcase.pre.clone();
      const cachedState = createCachedBeaconStateTest(state, getConfig(fork));
      operationFn(cachedState, testcase);
      state.commit();
      return state;
    },
    options: {
      inputTypes: {...inputTypeSszTreeViewDU, execution: InputType.YAML},
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        attestation: ssz.phase0.Attestation,
        attester_slashing: ssz.phase0.AttesterSlashing,
        block: ssz[fork].BeaconBlock,
        deposit: ssz.phase0.Deposit,
        proposer_slashing: ssz.phase0.ProposerSlashing,
        voluntary_exit: ssz.phase0.SignedVoluntaryExit,
        // Altair
        sync_aggregate: ssz.altair.SyncAggregate,
        // Bellatrix
        execution_payload: ssz.bellatrix.ExecutionPayload,
      },
      shouldError: (testCase) => testCase.post === undefined,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
    },
  };
};
