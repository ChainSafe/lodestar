import {
  allForks,
  altair,
  BeaconStateAllForks,
  bellatrix,
  CachedBeaconStateAllForks,
  CachedBeaconStateAltair,
  CachedBeaconStateBellatrix,
  CachedBeaconStatePhase0,
  phase0,
} from "@chainsafe/lodestar-beacon-state-transition";
import {processExecutionPayload} from "@chainsafe/lodestar-beacon-state-transition/bellatrix";
import {ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../utils/getConfig.js";
import {BaseSpecTest, shouldVerify, TestRunnerFn} from "../utils/types.js";
import {InputType} from "@chainsafe/lodestar-spec-test-util";

/* eslint-disable @typescript-eslint/naming-convention */

// Define above to re-use in sync_aggregate and sync_aggregate_random
const sync_aggregate: BlockProcessFn<CachedBeaconStateAltair | CachedBeaconStateBellatrix> = (
  state,
  testCase: {sync_aggregate: altair.SyncAggregate}
) => {
  const block = ssz.altair.BeaconBlock.defaultValue();

  // processSyncAggregate() needs the full block to get the slot
  block.slot = state.slot;
  block.body.syncAggregate = ssz.altair.SyncAggregate.toViewDU(testCase["sync_aggregate"]);

  altair.processSyncAggregate(state, block);
};

const operationFnsPhase0: Record<string, BlockProcessFn<CachedBeaconStatePhase0>> = {
  attestation: (state, testCase: {attestation: phase0.Attestation}) => {
    phase0.processAttestation(state, testCase.attestation);
  },

  attester_slashing: (state, testCase: BaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    phase0.processAttesterSlashing(state, testCase.attester_slashing, shouldVerify(testCase));
  },

  block_header: (state, testCase: {block: phase0.BeaconBlock}) => {
    allForks.processBlockHeader(state, testCase.block);
  },

  deposit: (state, testCase: {deposit: phase0.Deposit}) => {
    phase0.processDeposit(state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: {proposer_slashing: phase0.ProposerSlashing}) => {
    phase0.processProposerSlashing(state, testCase.proposer_slashing);
  },

  voluntary_exit: (state, testCase: {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    phase0.processVoluntaryExit(state, testCase.voluntary_exit);
  },
};

const operationFnsAltair: Record<string, BlockProcessFn<CachedBeaconStateAltair>> = {
  attestation: (state, testCase: {attestation: phase0.Attestation}) => {
    altair.processAttestations(state, [testCase.attestation]);
  },

  attester_slashing: (state, testCase: BaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    altair.processAttesterSlashing(state, testCase.attester_slashing, shouldVerify(testCase));
  },

  block_header: (state, testCase: {block: altair.BeaconBlock}) => {
    allForks.processBlockHeader(state, testCase.block);
  },

  deposit: (state, testCase: {deposit: phase0.Deposit}) => {
    altair.processDeposit(state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: {proposer_slashing: phase0.ProposerSlashing}) => {
    altair.processProposerSlashing(state, testCase.proposer_slashing);
  },

  sync_aggregate,
  sync_aggregate_random: sync_aggregate,

  voluntary_exit: (state, testCase: {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    altair.processVoluntaryExit(state, testCase.voluntary_exit);
  },
};

const operationFnsBellatrix: Record<string, BlockProcessFn<CachedBeaconStateBellatrix>> = {
  attestation: (state, testCase: {attestation: phase0.Attestation}) => {
    altair.processAttestations((state as CachedBeaconStateAllForks) as CachedBeaconStateAltair, [testCase.attestation]);
  },

  attester_slashing: (state, testCase: BaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    bellatrix.processAttesterSlashing(state, testCase.attester_slashing, shouldVerify(testCase));
  },

  block_header: (state, testCase: {block: altair.BeaconBlock}) => {
    allForks.processBlockHeader(state, testCase.block);
  },

  deposit: (state, testCase: {deposit: phase0.Deposit}) => {
    altair.processDeposit((state as CachedBeaconStateAllForks) as CachedBeaconStateAltair, testCase.deposit);
  },

  proposer_slashing: (state, testCase: {proposer_slashing: phase0.ProposerSlashing}) => {
    bellatrix.processProposerSlashing(state, testCase.proposer_slashing);
  },

  sync_aggregate,
  sync_aggregate_random: sync_aggregate,

  voluntary_exit: (state, testCase: {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    altair.processVoluntaryExit(
      (state as CachedBeaconStateAllForks) as CachedBeaconStateAltair,
      testCase.voluntary_exit
    );
  },

  execution_payload: (
    state,
    testCase: {execution_payload: bellatrix.ExecutionPayload; execution: {execution_valid: boolean}}
  ) => {
    processExecutionPayload(
      (state as CachedBeaconStateAllForks) as CachedBeaconStateBellatrix,
      testCase.execution_payload,
      {notifyNewPayload: () => testCase.execution.execution_valid}
    );
  },
};

const epochProcessFnByFork: Record<ForkName, Record<string, BlockProcessFn<any>>> = {
  [ForkName.phase0]: operationFnsPhase0,
  [ForkName.altair]: operationFnsAltair,
  [ForkName.bellatrix]: operationFnsBellatrix,
};

export type BlockProcessFn<T extends CachedBeaconStateAllForks> = (state: T, testCase: any) => void;

export type OperationsTestCase = {
  meta?: {bls_setting?: bigint};
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
  execution: {execution_valid: boolean};
};

export const operations: TestRunnerFn<OperationsTestCase, BeaconStateAllForks> = (fork, testName) => {
  const operationFn = epochProcessFnByFork[fork][testName];
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
