import {BeaconState, ProposerSlashing} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IProcessProposerSlashingTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  proposer_slashing: ProposerSlashing;
  pre: BeaconState;
  post?: BeaconState;
}
