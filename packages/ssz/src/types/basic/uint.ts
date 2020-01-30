import {BasicType} from "./abstract";

export interface IUintOptions {
  byteLength: number;
}

export class UintType<T> extends BasicType<T> {
  byteLength: number;
  constructor(options: IUintOptions) {
    super();
    this.byteLength = options.byteLength;
  }
  size(): number {
    return this.byteLength;
  }
}

export class NumberUintType extends UintType<number> {
  assertValidValue(value: unknown): asserts value is number {
    if (!(Number.isSafeInteger(value as number) || value === Infinity)) {
      throw new Error("Uint value is not a number");
    }
    if (value as unknown as number < 0) {
      throw new Error("Uint value must be gte 0");
    }
  }
  defaultValue(): number {
    return 0;
  }
  toBytes(value: number, output: Uint8Array, offset: number): number {
    if (this.byteLength > 6 && value === Infinity) {
      for (let i = offset; i < offset + this.byteLength; i++) {
        output[i] = 0xff;
      }
    } else {
      let v = value;
      for (let i = 0; i < this.byteLength; i ++) {
        output[offset + i] = v & 0xff;
        v >>= 8;
      }
    }
    return offset + this.byteLength;
  }
  fromBytes(data: Uint8Array, offset: number): number {
    let isInfinity = true;
    let output = 0;
    for (let i = 0; i < this.byteLength; i++) {
      output += data[offset + i] << (8 * i);
      if (data[offset + i] !== 255) {
        isInfinity = false;
      }
    }
    if (this.byteLength > 6 && isInfinity) {
      return Infinity;
    }
    return output;
  }
}

export class BigIntUintType extends UintType<bigint> {
  assertValidValue(value: unknown): asserts value is bigint {
    if (typeof value !== "bigint") {
      throw new Error("Uint value is not a bigint");
    }
    if (value as bigint < 0) {
      throw new Error("Uint value must be gte 0");
    }
  }
  defaultValue(): bigint {
    return BigInt(0);
  }
  toBytes(value: bigint, output: Uint8Array, offset: number): number {
    let v = value;
    for (let i = 0; i < this.byteLength; i ++) {
      output[offset + i] = Number(v & BigInt(0xff));
      v >>= BigInt(8);
    }
    return offset + this.byteLength;
  }
  fromBytes(data: Uint8Array, offset: number): bigint {
    let output = BigInt(0);
    for (let i = 0; i < this.byteLength; i++) {
      output += BigInt(data[offset + i]) << BigInt(8 * i);
    }
    return output;
  }
}
