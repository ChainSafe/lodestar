import {BasicType} from "@chainsafe/ssz";

export class StringType<T extends string = string> extends BasicType<T> {
  public toJson(value: T): string {
    return value;
  }

  public fromJson(data: string): T {
    return data as T;
  }

  public assertValidValue(data: unknown): data is T {
    throw new Error("unsupported ssz operation");
  }

  public serialize(): Uint8Array {
    throw new Error("unsupported ssz type for serialization");
  }

  public toBytes(): number {
    throw new Error("unsupported ssz type for serialization");
  }

  public fromBytes(): T {
    throw new Error("unsupported ssz operation");
  }

  public defaultValue(): T {
    return "something" as T;
  }
}
