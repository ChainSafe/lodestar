/**
 * SSZ is a type system that defines:
 * - efficient serialization / deserialization
 * - stable merkleization
 * - default constructor
 *
 * Along with these standardized operations, we provide:
 * - equality
 * - valid value assertion
 * - copy / clone
 * - constructor from partially formed value
 * - serialized byte length (for serialization)
 * - chunk count (for merkleization)
 *
 * This library operates on values of several kinds of 'backings', or underlying representations of data.
 * Each backing has runtime tradeoffs for the above operations that arise from the nature of the underlying
 * representation. Effort has been made to minimize the differences between backings for the core API, which
 * includes the above operations, property getter/setters, and iteration (value iteration for vectors/lists
 * and enumerable key iteration for containers).
 *
 * We support the following backings, which correspond to the core operations of serialization and merkleization:
 *
 * - Structural - This backing has a native javascript type representation.
 *     Containers are constructed as js Objects, vectors and lists as Arrays (or TypedArrays)
 *     Within operations, property access is performed using js getter notation, with gets
 *     corresponding to the structure of the value's type. Because structural non-constructor operations do not
 *     assume the underlying representation of values, all backings can be operated on in this context.
 *
 * - Tree - This backing has an immutable merkle tree representation.
 *     The data is always represented as a tree, and within operations, the tree
 *     structure is harnessed as much as possible. Property getters return subtrees except for basic types,
 *     when the native value corresponding th that type is returned.
 *     Values backed by a tree are wrapped in an ES6 Proxy object to provide a convenient, 'structural' interface
 *     for property getters/setters.
 *
 * - Serialized - This backing has a byte array representation.
 *     The data is always represented as a Uint8Array, and within operations,
 *     the serialized structure is harnessed as much as possible.
 *     Property getters return sub-arrays except for basic types, when the native value
 *     corresponding to that type is returned.
 *     Values backed by an array are wrapped in an ES6 Proxy object to provide a convenient, 'structural' interface
 *     for property getters/setters.
 */
import {
  BackedValue, isBackedValue,
  StructuralHandler, TreeHandler,
} from "../backings";

/**
 * A Type is either a BasicType or a CompositeType.
*/
export type Type<T> = BasicType<T> | (T extends object ? CompositeType<T>: never);

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
  assertValidValue(value: any): asserts value is T {
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

/**
 * A CompositeType is a type containing other types, and is flexible in its representation.
 *
 */
export class CompositeType<T extends object> {
  structural: StructuralHandler<T>;
  tree: TreeHandler<T>;

  isBasic(): this is BasicType<T> {
    return false;
  }

  /**
   * Valid value assertion
   */
  assertValidValue(value: any): asserts value is T {
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
