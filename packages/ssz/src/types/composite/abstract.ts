import {
  BackedValue, isBackedValue,
  StructuralHandler, TreeHandler, ByteArrayHandler,
} from "../../backings";

import {BasicType} from "../basic";

/**
 * A CompositeType is a type containing other types, and is flexible in its representation.
 *
 */
export class CompositeType<T extends object> {
  structural: StructuralHandler<T>;
  tree: TreeHandler<T>;
  byteArray: ByteArrayHandler<T>;

  isBasic(): this is BasicType<T> {
    return false;
  }

  /**
   * Valid value assertion
   */
  assertValidValue(value: unknown): asserts value is T {
    this.structural.assertValidValue(value);
  }

  /**
   * Equality
   */
  equals(value1: BackedValue<T> | T, value2: BackedValue<T> | T): boolean {
    if (isBackedValue(value1) && isBackedValue(value2)) {
      return value1.equals(value2);
    } else {
      return this.structural.equals(value1, value2);
    }
  }

  /**
   * Default constructor
   */
  defaultValue(): T {
    return this.structural.defaultValue();
  }

  /**
   * Clone / copy
   */
  clone(value: BackedValue<T> | T): BackedValue<T> | T {
    if (isBackedValue(value)) {
      return value.clone() as BackedValue<T>;
    } else {
      return this.structural.clone(value);
    }
  }

  /**
   * Constructor for partially formed input
   */
  createValue(value: any): T {
    throw new Error("Not implemented");
  }

  // Serialization / Deserialization

  /**
   * Check if type has a variable number of elements (or subelements)
   */
  isVariableSize(): boolean {
    throw new Error("Not implemented");
  }
  /**
   * Serialized byte length
   */
  size(value: BackedValue<T> | T): number {
    if (isBackedValue(value)) {
      return value.size();
    } else {
      return this.structural.size(value);
    }
  }

  /**
   * Low-level deserialization
   */
  fromBytes(data: Uint8Array, start: number, end: number): T {
    throw new Error("Not implemented");
  }
  /**
   * Deserialization
   */
  deserialize(data: Uint8Array): T {
    return this.structural.deserialize(data);
  }

  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(value: BackedValue<T> | T, output: Uint8Array, offset: number): number {
    if (isBackedValue(value)) {
      return value.toBytes(output, offset);
    } else {
      return this.structural.toBytes(value, output, offset);
    }
  }
  /**
   * Serialization
   */
  serialize(value: BackedValue<T> | T): Uint8Array {
    if (isBackedValue(value)) {
      return value.serialize();
    } else {
      return this.structural.serialize(value);
    }
  }

  // Merkleization

  /**
   * Return the number of leaf chunks to be merkleized
   */
  chunkCount(): number {
    throw new Error("Not implemented");
  }
  /**
   * Merkleization
   */
  hashTreeRoot(value: BackedValue<T> | T): Uint8Array {
    if (isBackedValue(value)) {
      return value.hashTreeRoot();
    } else {
      return this.structural.hashTreeRoot(value);
    }
  }
}
