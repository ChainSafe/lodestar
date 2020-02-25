import {Uint64} from "@chainsafe/lodestar-types";

export interface ShufflingTestCase {
  mapping: {
    seed: string;
    count: Uint64;
    mapping: Uint64[];
  };
}
