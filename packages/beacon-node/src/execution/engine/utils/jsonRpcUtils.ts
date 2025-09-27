// Utilities for JSON-RPC interaction, extracted from eth1/provider/utils.js

export type DATA = string;
export type QUANTITY = string;
export type QuantityStr = string;

export const rootHexRegex = /^0x[a-fA-F0-9]{64}$/;

export function numToQuantity(num: number | bigint): QUANTITY {
  return "0x" + num.toString(16);
}

export function quantityToNum(quantity: QUANTITY): number {
  const value = parseInt(quantity, 16);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid quantity: ${quantity}`);
  }
  return value;
}

export function quantityToBigint(quantity: QUANTITY): bigint {
  return BigInt(quantity);
}

export function bigintToQuantity(num: bigint): QUANTITY {
  return "0x" + num.toString(16);
}

export function dataToBytes(data: DATA, fixedLength?: number): Uint8Array {
  if (typeof data !== "string") {
    throw Error("data must be a hex string");
  }

  const dataWithoutPrefix = data.startsWith("0x") ? data.slice(2) : data;
  if (dataWithoutPrefix.length % 2 !== 0) {
    throw Error("data must have even number of hex characters");
  }

  const bytes = Buffer.from(dataWithoutPrefix, "hex");

  if (fixedLength !== undefined && bytes.length !== fixedLength) {
    throw Error(`data must be ${fixedLength} bytes, got ${bytes.length}`);
  }

  return bytes;
}

export function bytesToData(bytes: Uint8Array): DATA {
  return "0x" + Buffer.from(bytes).toString("hex");
}

export function dataIntoBytes(data: DATA): Uint8Array {
  return dataToBytes(data);
}

export function isJsonRpcTruncatedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("eth_getLogs") &&
    error.message.includes("query returned more than")
  );
}
