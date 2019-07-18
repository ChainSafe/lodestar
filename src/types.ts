/** @module ssz */
import BN from "bn.js";
import {BitList, BitVector} from "@chainsafe/bit-utils";

// Serializable values

export type Uint = number | BN;
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

export type SimplePrimitiveType = string;

export interface SimpleListType {
  elementType: AnySSZType;
  maxLength: number;
}

export interface SimpleVectorType {
  elementType: AnySSZType;
  length: number;
}

export interface SimpleContainerType {
  fields: [string, AnySSZType][];
}

/**
 * A convenient interface for specifying types
 *
 * In most cases, types are specified by users in simple form.
 * They will be parsed to a [[FullSSZType]] before any processing.
 */
export type SimpleSSZType = SimplePrimitiveType | SimpleListType | SimpleVectorType | SimpleContainerType;

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

export interface UintType {
  type: Type.uint;
  byteLength: number;
  useNumber: boolean;
}

export interface BoolType {
  type: Type.bool;
}

export interface BitListType {
  type: Type.bitList;
  maxLength: number;
}

export interface BitVectorType {
  type: Type.bitVector;
  length: number;
}

export type BitsType = BitListType | BitVectorType;

export interface ByteListType {
  type: Type.byteList;
  maxLength: number;
}

export interface ByteVectorType {
  type: Type.byteVector;
  length: number;
}

export type BytesType = ByteListType | ByteVectorType;

export interface ListType {
  type: Type.list;
  elementType: FullSSZType;
  maxLength: number;
}

export interface VectorType {
  type: Type.vector;
  elementType: FullSSZType;
  length: number;
}

export type ArrayType = ListType | VectorType;

export interface ContainerType {
  type: Type.container;
  fields: [string, FullSSZType][];
}

/**
 * A more consistent and verbose interface for specifying types
 *
 * Full types are used internally.
 */
export type FullSSZType = UintType | BoolType | BitsType | BytesType | ArrayType | ContainerType;

// simple + full types

export type AnyContainerType = ContainerType | SimpleContainerType;

export type AnySSZType = FullSSZType | SimpleSSZType;
