import {Bytes32, Number64} from "@chainsafe/lodestar-types";

export interface IEth1Block {
  hash: Bytes32;
  number: Number64;
  timestamp: Number64;
}
