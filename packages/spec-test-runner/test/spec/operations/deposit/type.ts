import {BeaconState, Deposit} from "@chainsafe/lodestar-types";

export interface IProcessDepositTestCase {
  deposit: Deposit;
  pre: BeaconState;
  post?: BeaconState;
}
