import {BasicType} from "@chainsafe/ssz";

export class StringType<T extends string = string> extends BasicType<T> {
  readonly typeName = "string";
  byteLength = 0;
  fixedSize = 0;
  minSize = 0;
  maxSize = 0;

  defaultValue(): T {
    return "" as T;
  }

  // Serialization + deserialization

  value_serializeToBytes(): number {
    throw Error("Not supported in String type");
  }
  value_deserializeFromBytes(): T {
    throw Error("Not supported in String type");
  }
  tree_serializeToBytes(): number {
    throw Error("Not supported in String type");
  }
  tree_deserializeFromBytes(): never {
    throw Error("Not supported in String type");
  }

  // Fast tree opts

  tree_getFromNode(): T {
    throw Error("Not supported in String type");
  }
  tree_setToNode(): void {
    throw Error("Not supported in String type");
  }
  tree_getFromPackedNode(): T {
    throw Error("Not supported in String type");
  }
  tree_setToPackedNode(): void {
    throw Error("Not supported in String type");
  }

  // JSON

  fromJson(json: unknown): T {
    return json as T;
  }

  toJson(value: T): unknown {
    return value;
  }
}

export const stringType = new StringType();
