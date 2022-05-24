import {phase0} from "@chainsafe/lodestar-types";
import {ZERO_HASH} from "../../src/constants/index.js";

export function generateEth1Data(blockHash = ZERO_HASH, depositCount = 0, depositRoot = ZERO_HASH): phase0.Eth1Data {
  return {
    blockHash,
    depositCount,
    depositRoot,
  };
}
