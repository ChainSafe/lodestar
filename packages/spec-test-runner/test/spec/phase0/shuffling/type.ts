import {Uint64} from "@chainsafe/lodestar-types";
import {IBaseSpecTest} from "../../type";

export interface IShufflingTestCase extends IBaseSpecTest {
  mapping: {
    seed: string;
    count: Uint64;
    mapping: Uint64[];
  };
}
