import {altair, phase0} from "@chainsafe/lodestar-types";

export interface IProcessDepositTestCase {
  deposit: phase0.Deposit;
  pre: altair.BeaconState;
  post?: altair.BeaconState;
}
