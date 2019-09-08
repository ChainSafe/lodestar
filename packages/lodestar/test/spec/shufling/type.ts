import {uint64} from "@chainsafe/eth2.0-types";

export interface ShufflingTestCase {
  mapping: {
    seed: string;
    count: uint64;
    mapping: uint64[];
  };
}