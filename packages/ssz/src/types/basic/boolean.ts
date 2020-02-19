import {Json} from "../../interface";
import {BasicType} from "./abstract";

export class BooleanType extends BasicType<boolean> {
  size(): number {
    return 1;
  }
  isBasic(): boolean {
    return true;
  }
  assertValidValue(value: unknown): asserts value is boolean {
    if (value !== true && value !== false) {
      throw new Error("Boolean value must be true or false");
    }
  }
  defaultValue(): boolean {
    return false;
  }
  toBytes(value: boolean, output: Uint8Array, offset: number): number {
    output[offset] = value ? 1 : 0;
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
  fromJson(data: Json): boolean {
    this.assertValidValue(data);
    return data;
  }
  toJson(value: boolean): Json {
    return value;
  }
}
