import {BasicType} from "@chainsafe/ssz";

/* eslint-disable @typescript-eslint/naming-convention */

export class StringType<T extends string = string> extends BasicType<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  struct_getSerializedLength(data?: string): number {
    throw new Error("unsupported ssz operation");
  }

  struct_convertToJson(value: T): string {
    return value;
  }

  struct_convertFromJson(data: string): T {
    return data as T;
  }

  struct_assertValidValue(data: unknown): data is T {
    throw new Error("unsupported ssz operation");
  }

  serialize(): Uint8Array {
    throw new Error("unsupported ssz type for serialization");
  }

  struct_serializeToBytes(): number {
    throw new Error("unsupported ssz type for serialization");
  }

  struct_deserializeFromBytes(): T {
    throw new Error("unsupported ssz operation");
  }

  struct_defaultValue(): T {
    return "something" as T;
  }
}
