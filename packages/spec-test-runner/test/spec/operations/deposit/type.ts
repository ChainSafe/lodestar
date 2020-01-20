import {BeaconState, Deposit} from "@chainsafe/eth2.0-types";

export interface ProcessDepositTestCase {

  deposit: Deposit;
  pre: BeaconState;
  post?: BeaconState;

}