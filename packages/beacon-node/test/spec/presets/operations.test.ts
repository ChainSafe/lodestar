import path from "node:path";
import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
  CachedBeaconStateCapella,
  CachedBeaconStateElectra,
  ExecutionPayloadStatus,
  getBlockRootAtSlot,
} from "@lodestar/state-transition";
import * as blockFns from "@lodestar/state-transition/block";
import {ssz, phase0, altair, bellatrix, capella, electra} from "@lodestar/types";
import {InputType} from "@lodestar/spec-test-util";
import {ACTIVE_PRESET, ForkName} from "@lodestar/params";

import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {getConfig} from "../../utils/config.js";
import {BaseSpecTest, RunnerType, shouldVerify, TestRunnerFn} from "../utils/types.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

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
  block.parentRoot = getBlockRootAtSlot(state, Math.max(block.slot, 1) - 1);

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

  deposit_receipt: (state, testCase: {deposit_receipt: electra.DepositReceipt}) => {
    const fork = state.config.getForkSeq(state.slot);
    blockFns.processDepositReceipt(fork, state as CachedBeaconStateElectra, testCase.deposit_receipt);
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

  execution_payload: (state, testCase: {body: bellatrix.BeaconBlockBody; execution: {execution_valid: boolean}}) => {
    const fork = state.config.getForkSeq(state.slot);
    blockFns.processExecutionPayload(fork, state as CachedBeaconStateBellatrix, testCase.body, {
      executionPayloadStatus: testCase.execution.execution_valid
        ? ExecutionPayloadStatus.valid
        : ExecutionPayloadStatus.invalid,
    });
  },

  bls_to_execution_change: (state, testCase: {address_change: capella.SignedBLSToExecutionChange}) => {
    blockFns.processBlsToExecutionChange(state as CachedBeaconStateCapella, testCase.address_change);
  },

  withdrawals: (state, testCase: {execution_payload: capella.ExecutionPayload}) => {
    blockFns.processWithdrawals(state as CachedBeaconStateCapella, testCase.execution_payload);
  },
};

export type BlockProcessFn<T extends CachedBeaconStateAllForks> = (state: T, testCase: any) => void;

export type OperationsTestCase = {
  meta?: {bls_setting?: bigint};
  pre: BeaconStateAllForks;
  post: BeaconStateAllForks;
  execution: {execution_valid: boolean};
};

const operations: TestRunnerFn<OperationsTestCase, BeaconStateAllForks> = (fork, testName) => {
  const operationFn = operationFns[testName];
  if (operationFn === undefined) {
    throw Error(`No operationFn for ${testName}`);
  }

  return {
    testFunction: (testcase) => {
      const state = testcase.pre.clone();
      const epoch = (state.fork as phase0.Fork).epoch;
      const cachedState = createCachedBeaconStateTest(state, getConfig(fork, epoch));

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
        body: ssz[fork].BeaconBlockBody,
        deposit: ssz.phase0.Deposit,
        deposit_receipt: ssz.electra.DepositReceipt,
        proposer_slashing: ssz.phase0.ProposerSlashing,
        voluntary_exit: ssz.phase0.SignedVoluntaryExit,
        // Altair
        sync_aggregate: ssz.altair.SyncAggregate,
        // Bellatrix
        execution_payload:
          fork !== ForkName.phase0 && fork !== ForkName.altair
            ? ssz.allForksExecution[fork as ExecutionFork].ExecutionPayload
            : ssz.bellatrix.ExecutionPayload,
        // Capella
        address_change: ssz.capella.SignedBLSToExecutionChange,
      },
      shouldError: (testCase) => testCase.post === undefined,
      getExpected: (testCase) => testCase.post,
      expectFunc: (testCase, expected, actual) => {
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type ExecutionFork = Exclude<ForkName, ForkName.phase0 | ForkName.altair>;

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  operations: {type: RunnerType.default, fn: operations},
});
