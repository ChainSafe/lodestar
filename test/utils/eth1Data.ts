import {Eth1Data} from "../../src/types";

export function eth1DataFromYaml(value: any): Eth1Data {
  return {
    depositRoot: Buffer.from(value.depositRoot.slice(2), 'hex'),
    blockHash: Buffer.from(value.blockHash.slice(2), 'hex'),
    depositCount: value.depositCount.toNumber(),
  };
}
