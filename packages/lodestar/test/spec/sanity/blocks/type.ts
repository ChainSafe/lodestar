import {BeaconBlock, BeaconState, Deposit, Hash, uint64} from "@chainsafe/eth2.0-types";

export interface BlockSanityTestCase {
  meta: {
    blocksCount: uint64;
  };
  pre: BeaconState;
  post: BeaconState;
  [k: string]: BeaconBlock|unknown|null|undefined;
}