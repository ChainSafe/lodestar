import {altair, phase0} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../../type";

export interface IProcessDepositTestCase extends IBaseSpecTest {
  deposit: phase0.Deposit;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
