import {Uint64} from "@chainsafe/eth2.0-types";

export interface ShufflingTestCase {
  mapping: {
    seed: string;
    count: Uint64;
    mapping: Uint64[];
  };
}
