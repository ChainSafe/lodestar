import {BeaconState, Deposit} from "@chainsafe/lodestar-types";

export interface ProcessDepositTestCase {

  deposit: Deposit;
  pre: BeaconState;
  post?: BeaconState;

}