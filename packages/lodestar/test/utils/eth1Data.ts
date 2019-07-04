import {Eth1Data} from "../../../types";
import {ZERO_HASH} from "../../constants";

export function generateEth1Data(blockHash = ZERO_HASH, depositCount = 0, depositRoot = ZERO_HASH): Eth1Data {
  return {
    blockHash,
    depositCount,
    depositRoot
  };
}
