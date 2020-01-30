import {
  BackedValue, isBackedValue,
  StructuralHandler, TreeHandler,
} from "../../backings";

/**
 * A BasicType is a terminal type, which has no flexibility in its representation.
 *
 * It is serialized as, at maximum, 32 bytes and merkleized as, at maximum, a single chunk
 */
export class BasicType<T> {
  isBasic(): this is BasicType<T> {
    return true;
  }

  /**
   * Valid value assertion
   */
  assertValidValue(value: unknown): asserts value is T {
    throw new Error("Not implemented");
  }

  /**
   * Default constructor
   */
  defaultValue(): T {
    throw new Error("Not implemented");
  }

  /**
   * Clone / copy
   */
  clone(value: T): T {
    return value;
  }

  /**
   * Constructor for partially formed input
   *
   * For basic types, there is no partially formed input
   */
  createValue(value: any): T {
    this.assertValidValue(value);
    return value;
  }

  /**
   * Equality
   */
  equals(value1: T, value2: T): boolean {
    this.assertValidValue(value1);
    this.assertValidValue(value2);
    return value1 === value2;
  }

  // Serialization / Deserialization

  /**
   * Check if type has a variable number of elements (or subelements)
   *
   * For basic types, this is always false
   */
  isVariableSize(): boolean {
    return false;
  }
  /**
   * Serialized byte length
   */
  size(): number {
    throw new Error("Not implemented");
  }

  /**
   * Low-level deserialization
   */
  fromBytes(data: Uint8Array, offset: number): T {
    throw new Error("Not implemented");
  }
  /**
   * Deserialization
   */
  deserialize(data: Uint8Array): T {
    return this.fromBytes(data, 0);
  }

  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(value: T, output: Uint8Array, offset: number): number {
    throw new Error("Not implemented");
  }
  /**
   * Serialization
   */
  serialize(value: T): Uint8Array {
    const output = new Uint8Array(this.size());
    this.toBytes(value, output, 0);
    return output;
  }

  /**
   * Merkleization
   */
  hashTreeRoot(value: T): Uint8Array {
    const output = new Uint8Array(32);
    this.toBytes(value, output, 0);
    return output;
  }
}
