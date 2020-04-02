import { Block } from "ethers/providers";
import { BigNumber } from "ethers/utils";

export function generateEth1BLock(opt: Partial<Block>): Block {
  return {
    hash: "",
    parentHash: "",
    number: 0,
    timestamp: 0,
    nonce: "",
    difficulty: 0,
    gasLimit: new BigNumber(0),
    gasUsed: new BigNumber(0),
    miner: "",
    extraData: "",
    transactions: [],
    ...opt
  }
}