import {BlockData, HeaderData} from "@ethereumjs/block";
import {ELBlock, ELTransaction} from "../types.js";
import {isTruthy} from "./assertion.js";

export function numberToHex(n: number | bigint): string {
  return "0x" + n.toString(16);
}

export function hexToNumber(n: string): number {
  return n.startsWith("0x") ? parseInt(n.slice(2), 16) : parseInt(n, 16);
}

export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(buffer).toString("hex");
}

export function hexToBuffer(v: string): Buffer {
  return Buffer.from(v.replace("0x", ""), "hex");
}

export function padLeft(v: Uint8Array, length: number): Uint8Array {
  const buf = Buffer.alloc(length);
  Buffer.from(v).copy(buf, length - v.length);
  return buf;
}

// TODO: fix blockInfo type
export function headerDataFromELBlock(blockInfo: ELBlock): HeaderData {
  return {
    parentHash: blockInfo.parentHash,
    uncleHash: blockInfo.sha3Uncles,
    coinbase: blockInfo.miner,
    stateRoot: blockInfo.stateRoot,
    transactionsTrie: blockInfo.transactionsRoot,
    receiptTrie: blockInfo.receiptsRoot,
    logsBloom: blockInfo.logsBloom,
    difficulty: BigInt(blockInfo.difficulty),
    number: BigInt(blockInfo.number),
    gasLimit: BigInt(blockInfo.gasLimit),
    gasUsed: BigInt(blockInfo.gasUsed),
    timestamp: BigInt(blockInfo.timestamp),
    extraData: blockInfo.extraData,
    mixHash: blockInfo.mixHash, // some reason the types are not up to date :(
    nonce: blockInfo.nonce,
    baseFeePerGas: blockInfo.baseFeePerGas ? BigInt(blockInfo.baseFeePerGas) : undefined,
    withdrawalsRoot: blockInfo.withdrawalsRoot ?? undefined,
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function txDataFromELBlock(txInfo: ELTransaction) {
  return {
    ...txInfo,
    data: txInfo.input,
    gasPrice: isTruthy(txInfo.gasPrice) ? BigInt(txInfo.gasPrice) : null,
    gasLimit: txInfo.gas,
    to: isTruthy(txInfo.to) ? padLeft(hexToBuffer(txInfo.to), 20) : undefined,
    value: BigInt(txInfo.value),
    maxFeePerGas: isTruthy(txInfo.maxFeePerGas) ? BigInt(txInfo.maxFeePerGas) : undefined,
    maxPriorityFeePerGas: isTruthy(txInfo.maxPriorityFeePerGas) ? BigInt(txInfo.maxPriorityFeePerGas) : undefined,
  };
}

export function blockDataFromELBlock(blockInfo: ELBlock): BlockData {
  return {
    header: headerDataFromELBlock(blockInfo),
    transactions: blockInfo.transactions.map(txDataFromELBlock) as BlockData["transactions"],
  };
}
