import {Eth1Data} from "@chainsafe/eth2.0-types";
import {ZERO_HASH} from "@chainsafe/eth2.0-constants";

export function generateEth1Data(blockHash = ZERO_HASH, depositCount = 0, depositRoot = ZERO_HASH): Eth1Data {
  return {
    blockHash,
    depositCount,
    depositRoot
  };
}
