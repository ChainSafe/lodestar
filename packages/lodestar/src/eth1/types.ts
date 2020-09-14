import {Eth1Data} from "@chainsafe/lodestar-types";

export interface IEth1DataWithBlock extends Eth1Data {
  blockNumber: number;
  timestamp: number;
}
