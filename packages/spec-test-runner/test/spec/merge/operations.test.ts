import {CachedBeaconState, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0, merge, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBaseSpecTest} from "../type";
import {operations, BlockProcessFn} from "../allForks/operations";
// eslint-disable-next-line no-restricted-imports
import {processExecutionPayload} from "@chainsafe/lodestar-beacon-state-transition/lib/merge/block/processExecutionPayload";

/* eslint-disable @typescript-eslint/naming-convention */

// Define above to re-use in sync_aggregate and sync_aggregate_random
const sync_aggregate: BlockProcessFn<altair.BeaconState> = (
  state,
  testCase: IBaseSpecTest & {sync_aggregate: altair.SyncAggregate}
) => {
  const block = ssz.altair.BeaconBlock.defaultTreeBacked();

  // processSyncAggregate() needs the full block to get the slot
  block.slot = state.slot;
  block.body.syncAggregate = testCase["sync_aggregate"];

  altair.processSyncAggregate(state, block);
};

operations<altair.BeaconState>(ForkName.merge, {
  attestation: (state, testCase: IBaseSpecTest & {attestation: phase0.Attestation}) => {
    altair.processAttestations(state, [testCase.attestation]);
  },

  attester_slashing: (state, testCase: IBaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    const verify = !!testCase.meta && !!testCase.meta.blsSetting && testCase.meta.blsSetting === BigInt(1);
    altair.processAttesterSlashing(state, testCase.attester_slashing, verify);
  },

  block_header: (state, testCase: IBaseSpecTest & {block: altair.BeaconBlock}) => {
    allForks.processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, testCase.block);
  },

  deposit: (state, testCase: IBaseSpecTest & {deposit: phase0.Deposit}) => {
    altair.processDeposit(state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: IBaseSpecTest & {proposer_slashing: phase0.ProposerSlashing}) => {
    altair.processProposerSlashing(state, testCase.proposer_slashing);
  },

  sync_aggregate,
  sync_aggregate_random: sync_aggregate,

  voluntary_exit: (state, testCase: IBaseSpecTest & {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    altair.processVoluntaryExit(state, testCase.voluntary_exit);
  },

  execution_payload: (
    state,
    testCase: IBaseSpecTest & {execution_payload: merge.ExecutionPayload; execution: {executionValid: boolean}}
  ) => {
    processExecutionPayload((state as unknown) as CachedBeaconState<merge.BeaconState>, testCase.execution_payload, {
      executePayload: () => testCase.execution.executionValid,
    });
  },
});
