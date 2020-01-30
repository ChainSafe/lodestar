import {CompositeType} from "../../types";
import {isBackedValue, BackingType} from "..";

export type ByteArrayBacking = Uint8Array;

/**
 * The IByteArrayBackedValue interface represents the public API that attach to byte-array-backed Proxy objects
 *
 * This is an alternative way of calling methods of the attached ByteArrayHandler
 */
export interface IByteArrayBackedValue<T extends object> {
  type(): CompositeType<T>;

  /**
   * Equality
   *
   * If both values are byte-array-backed, use equality by checking bytes, else use structural equality
   */
  equals(other: T): boolean;
  /**
   * Clone / Copy
   */
  clone(): ByteArrayBackedValue<T>;

  /**
   * Serialized byte length
   */
  size(): number;
  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(output: Uint8Array, offset: number): number;
  /**
   * Serialization
   */
  serialize(): Uint8Array;

  /**
   * Merkleization
   */
  hashTreeRoot(): Uint8Array;

  // Backing

  /**
   * The byte array backing
   */
  backing(): ByteArrayBacking;
  /**
   * The attached ByteArrayHandler
   */
  backingHandler(): ByteArrayHandler<T>;
  /**
   * The BackingType associated with the byte array backing
   */
  backingType(): BackingType;
}

/**
 * Since byte-array-backed values return byte-array-backed-values from non-basic-type property getters,
 * we need this type to recursively wrap subobjects (non-basic values) as byte-array-backed values.
 */
export type ByteArrayBackedValueify<T> = {
  [P in keyof T]: T[P] extends object ? ByteArrayBackedValue<T[P]> : T[P];
};

/**
 * A byte-array-backed value has the IByteArrayBackedValue public API as well as byte-array-backed getters/setters
 */
export type ByteArrayBackedValue<T extends object> = IByteArrayBackedValue<T> & ByteArrayBackedValueify<T> & T;

/**
 * Every property of a 'basic' byte-array-backed value is of a basic type, ie not a byte-array-backed value
 */
export type PropOfBasicByteArrayBackedValue<T extends object, V extends keyof T> = T[V];

/**
 * Every property of a 'composite' byte-array-backed value is of a composite type, ie a byte-array-backed value
 */
export type PropOfCompositeByteArrayBackedValue<T extends object, V extends keyof T> =
  T[V] extends object ? ByteArrayBackedValue<T[V]> : never;

export type PropOfByteArrayBackedValue<T extends object, V extends keyof T> =
  PropOfBasicByteArrayBackedValue<T, V> | PropOfCompositeByteArrayBackedValue<T, V>;

/**
 * A ByteArrayHandler instance handles byte-array-backed-specific logic.
 * It is a property of its associated CompositeType, and vice-versa.
 * It is also attached to each ByteArrayBackedValue as its ES6 Proxy handler
 *
 * These methods can be used in both contexts (when part of IByteArrayBackedValue):
 * eg:
 *   Type.byteArray.serialize(byteArrayBacking)
 *   and
 *   byteArrayBackedValue.serialize()
 */
export class ByteArrayHandler<T extends object> implements ProxyHandler<T> {
  protected _type: CompositeType<T>;
  type(): CompositeType<T> {
    return this._type;
  }
  /**
   * The byte array backing
   */
  backing(target: ByteArrayBacking): ByteArrayBacking {
    return target;
  }
  /**
   * The attached ByteArrayHandler
   */
  backingHandler(): this {
    return this;
  }
  /**
   * The BackingType associated with the byte array backing
   */
  backingType(): BackingType {
    return BackingType.byteArray;
  }
  /**
   * Default byte array
   */
  defaultBacking(): ByteArrayBacking {
    throw new Error("Not implemented");
  }
  /**
   * Default constructor
   */
  defaultValue(): ByteArrayBackedValue<T> {
    return this.createBackedValue((this.defaultBacking()));
  }
  createValue(value: T): ByteArrayBackedValue<T> {
    throw new Error("Not implemented");
  }
  /**
   * Return an ES6 Proxy-wrapped byte array backing
   */
  createBackedValue(target: ByteArrayBacking): ByteArrayBackedValue<T> {
    return new Proxy(target, this) as ByteArrayBackedValue<T>;
  }
  /**
   * Clone / copy
   */
  clone(target: ByteArrayBacking): ByteArrayBackedValue<T> {
    const newTarget = new Uint8Array(target.length);
    newTarget.set(target);
    return this.createBackedValue(newTarget);
  }
  /**
   * Equality
   *
   * If both values are byte-array-backed, use equality byte-by-byte, else use structural equality
   */
  equals(target: ByteArrayBacking, other: ByteArrayBackedValue<T>): boolean {
    if (isBackedValue(other) && other.backingType() === this.backingType()) {
      const otherTarget = other.backing();
      if (target.length !== otherTarget.length) {
        return false;
      }
      for (let i = 0; i < target.length; i++) {
        if (target[i] !== otherTarget[i]) {
          return false;
        }
      }
      return true;
    }
    return this._type.structural.equals(this.createBackedValue(target), other);
  }

  // Serialization

  getVariableOffsets(target: ByteArrayBacking): [number, number][] {
    throw new Error("Not implemented");
  }

  getByteBits(target: ByteArrayBacking, offset: number): boolean[] {
    const byte = target[offset];
    if (!byte) {
      return [
        false, false, false, false,
        false, false, false, false,
      ];
    }
    const bits = Array.prototype.map.call(
      byte.toString(2).padStart(8, "0"),
      (c) => c === "1" ? true : false
    ).reverse() as boolean[];
    return bits;
  }

  toHexString(target: ByteArrayBacking): string {
    return "0x" + [...target].map(b => b.toString(16).padStart(2, "0")).join("");
  }
  fromHexString(data: string): ByteArrayBacking {
    if (typeof data !== "string") {
      throw new Error("Expected string");
    }
    if (data.length % 2 !== 0) {
      throw new Error("Expected an even number of characters");
    }
    data = data.replace("0x", "");
    return new Uint8Array(data.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  }

  /**
   * Serialized byte length
   */
  size(target: ByteArrayBacking): number {
    return target.length;
  }
  /**
   * Low-level deserialization
   */
  fromBytes(data: Uint8Array, start: number, end: number): ByteArrayBackedValue<T> {
    const target = new Uint8Array(end - start);
    target.set(new Uint8Array(data.buffer, data.byteOffset + start, end - start));
    return this.createBackedValue(target);
  }
  /**
   * Deserialization
   */
  deserialize(data: Uint8Array): ByteArrayBackedValue<T> {
    return this.fromBytes(data, 0, data.length);
  }
  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(target: ByteArrayBacking, output: Uint8Array, offset: number): number {
    output.set(target, offset);
    return offset + target.length;
  }
  /**
   * Serialization
   */
  serialize(target: ByteArrayBacking): Uint8Array {
    const output = new Uint8Array(this.size(target));
    this.toBytes(target, output, 0);
    return output;
  }

  /**
   * Merkleization
   */
  hashTreeRoot(target: ByteArrayBacking): Uint8Array {
    throw new Error("Not implemented");
  }

  /**
   * Return a IByteArrayBackedValue method, to be called using the IByteArrayBackedValue interface
   */
  protected getMethod<V extends keyof IByteArrayBackedValue<T>>(target: ByteArrayBacking, methodName: V): IByteArrayBackedValue<T>[V] {
    return (this as any)[methodName].bind(this, target);
  }
  /**
   * Return a property of T, either a subarray ByteArrayBackedValue or a primitive, of a basic type
   */
  getProperty(target: ByteArrayBacking, property: keyof T): PropOfByteArrayBackedValue<T, keyof T> {
    throw new Error("Not implemented");
  }
  /**
   * ES6 Proxy trap to get a IByteArrayBackedValue method or property of T
   */
  get(target: any, property: PropertyKey): PropOfByteArrayBackedValue<T, keyof T> | IByteArrayBackedValue<T>[keyof IByteArrayBackedValue<T>] {
    if (property in this) {
      return this.getMethod(target, property as keyof IByteArrayBackedValue<T>);
    } else {
      return this.getProperty(target, property as keyof T);
    }
  }
  /**
   * ES6 Proxy trap to set a property of T
   */
  set(target: any, property: PropertyKey, value: unknown): boolean {
    throw new Error("Not implemented");
  }
}
