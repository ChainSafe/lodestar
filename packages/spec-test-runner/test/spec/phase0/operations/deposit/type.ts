import {phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessDepositTestCase extends IBaseSpecTest {
  deposit: phase0.Deposit;
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
}
