import {Eth1Data} from "../../src/types";
import {ZERO_HASH} from "../../src/constants";

export function generateEth1Data(blockHash = ZERO_HASH, depositCount = 0, depositRoot = ZERO_HASH): Eth1Data {
  return {
    blockHash,
    depositCount,
    depositRoot
  };
}

export function eth1DataFromYaml(value: any): Eth1Data {
  return {
    depositRoot: Buffer.from(value.depositRoot.slice(2), 'hex'),
    blockHash: Buffer.from(value.blockHash.slice(2), 'hex'),
    depositCount: value.depositCount.toNumber(),
  };
}
