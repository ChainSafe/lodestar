import {toBufferLE, toBigIntLE, toBufferBE, toBigIntBE} from "bigint-buffer";
import {copyFromBuf64LE, copyFromBuf64BE, copyToBuf64LE, copyToBuf64BE} from "./buf64copy";

type Endianness = "le" | "be";

/**
 * Return a byte array from a number or BigInt
 */
export function intToBytes(value: bigint | number, length: number, endianness: Endianness = "le"): Buffer {
  switch (typeof value) {
    case "number":
      return numberToBytes(value, length, endianness);
    case "bigint":
      return bigIntToBytes(value, length, endianness);
      break;
    default:
      throw new Error(`unsupported number type ${typeof value}`);
  }
}

/**
 * Convert byte array in LE to integer.
 */

const bufferG = new ArrayBuffer(8);
const viewG = new DataView(bufferG);

export function numberToBytes(value: number, length: number, endianness: Endianness = "le"): Buffer {
  if (length > 8 || value > Number.MAX_SAFE_INTEGER || value < -Number.MAX_SAFE_INTEGER)
    return intToBytes(BigInt(value), length, endianness);
  //can't handle if above conds are true
  //length less than required will lead to truncation on the msb side, same as bigint inttobytes

  if (value < 0) value = -value; //bigint inttobytes always return the absolute value

  let mvalue;
  const view = viewG;
  const result = Buffer.allocUnsafe(length);
  const sbuffer = Buffer.from(bufferG);

  switch (endianness) {
    case "le":
      view.setInt32(0, value, true);
      if (length > 4) {
        mvalue = Math.floor(value / 2 ** 32);
        view.setInt32(4, mvalue, true);
      }
      copyFromBuf64LE(sbuffer, result, length);
      break;
    case "be":
      view.setInt32(4, value, false);

      if (length > 4) {
        mvalue = Math.floor(value / 2 ** 32);
        view.setInt32(0, mvalue, false);
      }
      copyFromBuf64BE(sbuffer, result, length);
      break;
    default:
      throw new Error("endianness must be either 'le' or 'be'");
  }
  return result;
}

export function bytesToInt(value: Uint8Array, endianness: Endianness = "le"): number {
  let isbigint: boolean | number = false;

  let left, right;
  const buffer = Buffer.from(bufferG);
  const view = viewG;
  const length = value.length;

  if (length > 8) return Number(bytesToBigInt(value, endianness)); //can't handle more than 64 bits

  switch (endianness) {
    case "le":
      if (length > 6) isbigint = value[6] > 31 || (length == 8 && value[7] > 0);
      if (isbigint) return Number(bytesToBigInt(value, endianness));
      copyToBuf64LE(value, buffer, length);
      left = view.getUint32(4, true);
      right = view.getUint32(0, true);
      break;
    case "be":
      if (length > 6) isbigint = value[length - 7] > 31 || (length == 8 && value[0] > 0);
      if (isbigint) return Number(bytesToBigInt(value, endianness));
      copyToBuf64BE(value, buffer, length);
      left = view.getUint32(0, false);
      right = view.getUint32(4, false);
      break;
  }

  const combined = 2 ** 32 * left + right;
  return combined;
}

export function bigIntToBytes(value: bigint, length: number, endianness: Endianness = "le"): Buffer {
  if (endianness === "le") {
    return toBufferLE(value, length);
  } else if (endianness === "be") {
    return toBufferBE(value, length);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function bytesToBigInt(value: Uint8Array, endianness: Endianness = "le"): bigint {
  if (endianness === "le") {
    return toBigIntLE(value as Buffer);
  } else if (endianness === "be") {
    return toBigIntBE(value as Buffer);
  }
  throw new Error("endianness must be either 'le' or 'be'");
}

export function toHex(buffer: Parameters<typeof Buffer.from>[0]): string {
  if (Buffer.isBuffer(buffer)) {
    return "0x" + buffer.toString("hex");
  } else if (buffer instanceof Uint8Array) {
    return "0x" + Buffer.from(buffer.buffer, buffer.byteOffset, buffer.length).toString("hex");
  } else {
    return "0x" + Buffer.from(buffer).toString("hex");
  }
}

export function fromHex(hex: string): Uint8Array {
  const b = Buffer.from(hex.replace("0x", ""), "hex");
  return new Uint8Array(b.buffer, b.byteOffset, b.length);
}
