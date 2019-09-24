import {BeaconBlock, BeaconState} from "@chainsafe/eth2.0-types";

export interface ProcessBlockHeader {

  block: BeaconBlock;
  pre: BeaconState;
  post?: BeaconState;

}