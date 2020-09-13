import {Bytes32, Number64} from "@chainsafe/lodestar-types";

export interface IEth1Block {
  blockHash: Bytes32; // Use blockHash to be consistent with the Eth1Data type
  blockNumber: Number64;
  timestamp: Number64;
}
