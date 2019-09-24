import {BeaconState, Transfer} from "@chainsafe/eth2.0-types";

export interface ProcessTransferTestCase {

  transfer: Transfer;
  pre: BeaconState;
  post?: BeaconState;

}