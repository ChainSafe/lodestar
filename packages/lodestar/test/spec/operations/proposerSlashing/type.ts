import {BeaconState, ProposerSlashing} from "@chainsafe/eth2.0-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessProposerSlashingTestCase extends IBaseSpecTest {

  proposer_slashing: ProposerSlashing;
  pre: BeaconState;
  post?: BeaconState;

}