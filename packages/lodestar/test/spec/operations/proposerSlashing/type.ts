import {BeaconState, ProposerSlashing} from "@chainsafe/eth2.0-types";

export interface ProcessProposerSlashingTestCase {

  proposer_slashing: ProposerSlashing;
  pre: BeaconState;
  post?: BeaconState;

}