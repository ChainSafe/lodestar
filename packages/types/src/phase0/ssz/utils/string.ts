import {BasicType} from "@chainsafe/ssz";

export class StringType<T extends string = string> extends BasicType<T> {
  toJson(value: T): string {
    return value;
  }

  fromJson(data: string): T {
    return data as T;
  }

  assertValidValue(data: unknown): data is T {
    throw new Error("unsupported ssz operation");
  }

  serialize(): Uint8Array {
    throw new Error("unsupported ssz type for serialization");
  }

  toBytes(): number {
    throw new Error("unsupported ssz type for serialization");
  }

  fromBytes(): T {
    throw new Error("unsupported ssz operation");
  }

  defaultValue(): T {
    return "something" as T;
  }
}
