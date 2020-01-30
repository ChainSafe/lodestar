import {BasicType} from "./abstract";

export class BooleanType extends BasicType<boolean> {
  size(): number {
    return 1;
  }
  isVariableSize(): boolean {
    return false;
  }
  isBasic(): boolean {
    return true;
  }
  assertValidValue(value: unknown): asserts value is boolean {
    if (value !== true && value !== false) {
      throw new Error("Boolean value must be true or false");
    }
  }
  equals(value1: boolean, value2: boolean): boolean {
    this.assertValidValue(value1);
    this.assertValidValue(value2);
    return value1 === value2;
  }
  defaultValue(): boolean {
    return false;
  }
  createValue(value: any): boolean {
    return value;
  }
  toBytes(value: boolean, output: Uint8Array, offset: number): number {
    if (value) {
      output[offset] = 1;
    }
    return offset + 1;
  }
  fromBytes(data: Uint8Array, offset: number): boolean {
    if (data[offset] === 1) {
      return true;
    } else if (data[offset] === 0) {
      return false;
    } else {
      throw new Error("Invalid boolean value");
    }
  }
}
