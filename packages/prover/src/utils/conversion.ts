import {BlockData, HeaderData} from "@ethereumjs/block";
import {ELBlock, ELTransaction} from "../types.js";
import {isTruthy} from "./assertion.js";

export function numberToHex(num: number | bigint): string {
  return "0x" + num.toString(16);
}

export function hexToNumber(num: string): number {
  return num.startsWith("0x") ? parseInt(num.slice(2), 16) : parseInt(num, 16);
}

export function hexToBigInt(num: string): bigint {
  return num.startsWith("0x") ? BigInt(num) : BigInt(`0x${num}`);
}

export function bigIntToHex(num: bigint): string {
  return `0x${num.toString(16)}`;
}

export function bufferToHex(buffer: Buffer | Uint8Array): string {
  return "0x" + Buffer.from(buffer).toString("hex");
}

export function hexToBuffer(val: string): Buffer {
  const hexWithEvenLength = val.length % 2 ? `0${val}` : val;
  return Buffer.from(hexWithEvenLength.replace("0x", ""), "hex");
}

export function padLeft<T extends Buffer | Uint8Array>(v: T, length: number): T {
  const buf = Buffer.alloc(length);
  Buffer.from(v).copy(buf, length - v.length);

  if (Buffer.isBuffer(v)) return buf as T;

  return Uint8Array.from(buf) as T;
}

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

export function txDataFromELBlock(txInfo: ELTransaction) {
  return {
    ...txInfo,
    data: txInfo.input,
    gasPrice: isTruthy(txInfo.gasPrice) ? BigInt(txInfo.gasPrice) : null,
    gasLimit: txInfo.gas,
    to: isTruthy(txInfo.to) ? padLeft(hexToBuffer(txInfo.to), 20) : undefined,
    value: txInfo.value ? BigInt(txInfo.value) : undefined,
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

export function cleanObject<T extends Record<string, unknown> | unknown[]>(obj: T): T {
  const isNullify = (v: unknown): boolean => v === undefined || v === null;

  if (Array.isArray(obj)) return obj.filter((v) => isNullify(v)) as T;

  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      if (isNullify(obj[key])) {
        delete obj[key];
      } else if (typeof obj[key] === "object") {
        cleanObject(obj[key] as Record<string, unknown>);
      }
    }
  }

  return obj;
}

/**
 * Convert an array to array of chunks of length N
 * @example
 * chunkIntoN([1,2,3,4,5,6], 2)
 * => [[1,2], [3,4], [5,6]]
 */
export function chunkIntoN<T extends unknown[]>(arr: T, n: number): T[] {
  return Array.from({length: Math.ceil(arr.length / n)}, (_, i) => arr.slice(i * n, i * n + n)) as T[];
}
