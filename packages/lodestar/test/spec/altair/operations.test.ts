import {CachedBeaconStateAllForks, allForks, altair} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBaseSpecTest, shouldVerify} from "../type";
import {operations, BlockProcessFn} from "../allForks/operations";

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

operations<altair.BeaconState>(ForkName.altair, {
  attestation: (state, testCase: IBaseSpecTest & {attestation: phase0.Attestation}) => {
    altair.processAttestations(state, [testCase.attestation]);
  },

  attester_slashing: (state, testCase: IBaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    altair.processAttesterSlashing(state, testCase.attester_slashing, shouldVerify(testCase));
  },

  block_header: (state, testCase: IBaseSpecTest & {block: altair.BeaconBlock}) => {
    allForks.processBlockHeader(state as CachedBeaconStateAllForks, testCase.block);
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
});
