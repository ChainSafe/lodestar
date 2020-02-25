import {BeaconState, ProposerSlashing} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessProposerSlashingTestCase extends IBaseSpecTest {

  proposer_slashing: ProposerSlashing;
  pre: BeaconState;
  post?: BeaconState;

}