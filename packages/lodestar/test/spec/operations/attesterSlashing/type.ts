import {AttesterSlashing, BeaconState} from "@chainsafe/eth2.0-types";

export interface ProcessAttesterSlashingTestCase {

  attester_slashing: AttesterSlashing;
  pre: BeaconState;
  post?: BeaconState;

}