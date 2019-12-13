/* eslint-disable @typescript-eslint/interface-name-prefix, @typescript-eslint/no-explicit-any */

// Serializable values

import {BitList, BitVector} from "@chainsafe/bit-utils";
import BN from "bn.js";

export type Uint = number | bigint | BN;
export type Bool = boolean;
export type Bits = BitList | BitVector;
export type Bytes = Buffer | Uint8Array;
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SerializableArray extends Array<SerializableValue> {}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SerializableObject extends Record<string, SerializableValue> {}
export type SerializableValue = Uint | Bool | Bits | Bytes | SerializableArray | SerializableObject;

// Simple types
// These types are supplied to provide a convenient interface with which to specify types

export type SimplePrimitiveType<T=any> = string;

export interface SimpleListType<T=any> {
  elementType: AnySSZType;
  maxLength: number;
}

export interface SimpleVectorType<T=any> {
  elementType: AnySSZType;
  length: number;
}

export interface SimpleContainerType<T=any> {
  fields: [string, AnySSZType][];
}

/**
 * A convenient interface for specifying types
 *
 * In most cases, types are specified by users in simple form.
 * They will be parsed to a [[FullSSZType]] before any processing.
 */
export type SimpleSSZType<T=any> =
  SimplePrimitiveType<T> | SimpleListType<T> | SimpleVectorType<T> | SimpleContainerType<T>;

// Full types
// These types are used internally

export enum Type {
  uint,
  bool,
  bitList,
  bitVector,
  byteList,
  byteVector,
  list,
  vector,
  container,
}

export enum UintImpl {
  number = "number",
  bigint = "bigint",
  bn ="bn",
}

export interface UintType<T=any> {
  type: Type.uint;
  byteLength: number;
  use: UintImpl[keyof UintImpl];
}

export interface BoolType<T=any> {
  type: Type.bool;
}

export interface BitListType<T=any> {
  type: Type.bitList;
  maxLength: number;
}

export interface BitVectorType<T=any> {
  type: Type.bitVector;
  length: number;
}

export type BitsType<T=any> = BitListType<T> | BitVectorType<T>;

export interface ByteListType<T=any> {
  type: Type.byteList;
  maxLength: number;
}

export interface ByteVectorType<T=any> {
  type: Type.byteVector;
  length: number;
}

export type BytesType<T=any> = ByteListType<T> | ByteVectorType<T>;

export interface ListType<T=any> {
  type: Type.list;
  elementType: FullSSZType;
  maxLength: number;
}

export interface VectorType<T=any> {
  type: Type.vector;
  elementType: FullSSZType;
  length: number;
}

export type ArrayType<T=any> = ListType<T> | VectorType<T>;

export interface ContainerType<T=any> {
  type: Type.container;
  fields: [string, FullSSZType][];
}

/**
 * A more consistent and verbose interface for specifying types
 *
 * Full types are used internally.
 */
export type FullSSZType<T=any> =
  UintType<T> | BoolType<T> | BitsType<T> | BytesType<T> | ArrayType<T> | ContainerType<T>;

// simple + full types

export type AnyContainerType<T=any> = ContainerType<T> | SimpleContainerType<T>;

export type AnySSZType<T=any> = FullSSZType<T> | SimpleSSZType<T>;

// useful primitive types

export const bit: BoolType<boolean> = {
  type: Type.bool,
};

export const byte: UintType<number> = {
  type: Type.uint,
  byteLength: 1,
  use: "number",
};
