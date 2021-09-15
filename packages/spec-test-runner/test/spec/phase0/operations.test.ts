import {CachedBeaconState, allForks, phase0} from "@chainsafe/lodestar-beacon-state-transition";
import {ForkName} from "@chainsafe/lodestar-params";
import {IBaseSpecTest} from "../type";
import {operations} from "../allForks/operations";

/* eslint-disable @typescript-eslint/naming-convention */

/** Describe with which function to run each directory of tests */
operations<phase0.BeaconState>(ForkName.phase0, {
  attestation: (state, testCase: IBaseSpecTest & {attestation: phase0.Attestation}) => {
    phase0.processAttestation(state, testCase.attestation);
  },

  attester_slashing: (state, testCase: IBaseSpecTest & {attester_slashing: phase0.AttesterSlashing}) => {
    const verify = !!testCase.meta && !!testCase.meta.blsSetting && testCase.meta.blsSetting === BigInt(1);
    phase0.processAttesterSlashing(state, testCase.attester_slashing, verify);
  },

  block_header: (state, testCase: IBaseSpecTest & {block: phase0.BeaconBlock}) => {
    allForks.processBlockHeader(state as CachedBeaconState<allForks.BeaconState>, testCase.block);
  },

  deposit: (state, testCase: IBaseSpecTest & {deposit: phase0.Deposit}) => {
    phase0.processDeposit(state, testCase.deposit);
  },

  proposer_slashing: (state, testCase: IBaseSpecTest & {proposer_slashing: phase0.ProposerSlashing}) => {
    phase0.processProposerSlashing(state, testCase.proposer_slashing);
  },

  voluntary_exit: (state, testCase: IBaseSpecTest & {voluntary_exit: phase0.SignedVoluntaryExit}) => {
    phase0.processVoluntaryExit(state, testCase.voluntary_exit);
  },
});
