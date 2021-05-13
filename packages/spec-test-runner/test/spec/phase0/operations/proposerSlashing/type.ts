import {phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessProposerSlashingTestCase extends IBaseSpecTest {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  proposer_slashing: phase0.ProposerSlashing;
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
}
