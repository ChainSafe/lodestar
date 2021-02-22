import {phase0} from "@chainsafe/lodestar-types";

export interface IProcessDepositTestCase {
  deposit: phase0.Deposit;
  pre: phase0.BeaconState;
  post?: phase0.BeaconState;
}
