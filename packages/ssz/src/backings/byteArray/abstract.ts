import {ByteVector} from "../../interface";
import {CompositeType} from "../../types";
import {BackingType} from "../backedValue";

export function toHexString(target: Uint8Array | ByteVector): string {
  return "0x" + [...target].map(b => b.toString(16).padStart(2, "0")).join("");
}
export function fromHexString(data: string): Uint8Array {
  if (typeof data !== "string") {
    throw new Error("Expected hex string to be a string");
  }
  if (data.length % 2 !== 0) {
    throw new Error("Expected an even number of characters");
  }
  data = data.replace("0x", "");
  return new Uint8Array(data.match(/.{1,2}/g).map(b => parseInt(b, 16)));
}

export function byteArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((v, i) => v === b[i]);
}

export function isByteArrayBacked<T extends object>(value: T): value is ByteArrayBacked<T> {
  return (
    (value as ByteArrayBacked<T>).backingType &&
    (value as ByteArrayBacked<T>).backingType() === BackingType.byteArray
  );
}

/**
 * The IByteArrayBacked interface represents the public API that attach to byte-array-backed Proxy objects
 *
 * This is an alternative way of calling methods of the attached ByteArrayHandler
 */
export interface IByteArrayBacked<T extends object> {
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
  clone(): ByteArrayBacked<T>;

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
  backing(): Uint8Array;
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
export type ByteArrayBackedify<T> = {
  [P in keyof T]: T[P] extends object ? ByteArrayBacked<T[P]> : T[P];
};

/**
 * A byte-array-backed value has the IByteArrayBacked public API as well as byte-array-backed getters/setters
 */
export type ByteArrayBacked<T extends object> = IByteArrayBacked<T> & ByteArrayBackedify<T> & T;

/**
 * Every property of a 'basic' byte-array-backed value is of a basic type, ie not a byte-array-backed value
 */
export type PropOfBasicByteArrayBacked<T extends object, V extends keyof T> = T[V];

/**
 * Every property of a 'composite' byte-array-backed value is of a composite type, ie a byte-array-backed value
 */
export type PropOfCompositeByteArrayBacked<T extends object, V extends keyof T> =
  T[V] extends object ? ByteArrayBacked<T[V]> : never;

export type PropOfByteArrayBacked<T extends object, V extends keyof T> =
  PropOfBasicByteArrayBacked<T, V> | PropOfCompositeByteArrayBacked<T, V>;

/**
 * A ByteArrayHandler instance handles byte-array-backed-specific logic.
 * It is a property of its associated CompositeType, and vice-versa.
 * It is also attached to each ByteArrayBacked as its ES6 Proxy handler
 *
 * These methods can be used in both contexts (when part of IByteArrayBacked):
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
  backing(target: Uint8Array): Uint8Array {
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
  defaultBacking(): Uint8Array {
    throw new Error("Not implemented");
  }
  /**
   * Default constructor
   */
  defaultValue(): ByteArrayBacked<T> {
    return this.asByteArrayBacked((this.defaultBacking()));
  }
  createValue(value: T): ByteArrayBacked<T> {
    throw new Error("Not implemented");
  }
  /**
   * Return an ES6 Proxy-wrapped byte array backing
   */
  asByteArrayBacked(target: Uint8Array): ByteArrayBacked<T> {
    return new Proxy(target, this) as ByteArrayBacked<T>;
  }
  /**
   * Clone / copy
   */
  clone(target: Uint8Array): ByteArrayBacked<T> {
    const newTarget = new Uint8Array(target.length);
    newTarget.set(target);
    return this.asByteArrayBacked(newTarget);
  }
  /**
   * Equality
   *
   * If both values are byte-array-backed, use equality byte-by-byte, else use structural equality
   */
  equals(target: Uint8Array, other: ByteArrayBacked<T>): boolean {
    if (isByteArrayBacked(other)) {
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
    return this._type.structural.equals(this.asByteArrayBacked(target), other);
  }

  // Serialization

  getVariableOffsets(target: Uint8Array): [number, number][] {
    throw new Error("Not implemented");
  }

  getByteBits(target: Uint8Array, offset: number): boolean[] {
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

  /**
   * Serialized byte length
   */
  size(target: Uint8Array): number {
    return target.length;
  }
  /**
   * Low-level deserialization
   */
  fromBytes(data: Uint8Array, start: number, end: number): ByteArrayBacked<T> {
    const target = new Uint8Array(end - start);
    target.set(new Uint8Array(data.buffer, data.byteOffset + start, end - start));
    return this.asByteArrayBacked(target);
  }
  /**
   * Deserialization
   */
  deserialize(data: Uint8Array): ByteArrayBacked<T> {
    return this.fromBytes(data, 0, data.length);
  }
  /**
   * Low-level serialization
   *
   * Serializes to a pre-allocated Uint8Array
   */
  toBytes(target: Uint8Array, output: Uint8Array, offset: number): number {
    output.set(target, offset);
    return offset + target.length;
  }
  /**
   * Serialization
   */
  serialize(target: Uint8Array): Uint8Array {
    const output = new Uint8Array(this.size(target));
    this.toBytes(target, output, 0);
    return output;
  }

  /**
   * Merkleization
   */
  hashTreeRoot(target: Uint8Array): Uint8Array {
    throw new Error("Not implemented");
  }

  /**
   * Return a IByteArrayBacked method, to be called using the IByteArrayBacked interface
   */
  protected getMethod<V extends keyof IByteArrayBacked<T>>(target: Uint8Array, methodName: V): IByteArrayBacked<T>[V] {
    return (this as any)[methodName].bind(this, target);
  }
  /**
   * Return a property of T, either a subarray ByteArrayBacked or a primitive, of a basic type
   */
  getProperty(target: Uint8Array, property: keyof T): PropOfByteArrayBacked<T, keyof T> {
    throw new Error("Not implemented");
  }
  /**
   * ES6 Proxy trap to get a IByteArrayBacked method or property of T
   */
  get(target: any, property: PropertyKey): PropOfByteArrayBacked<T, keyof T> | IByteArrayBacked<T>[keyof IByteArrayBacked<T>] {
    if (property in this) {
      return this.getMethod(target, property as keyof IByteArrayBacked<T>);
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
