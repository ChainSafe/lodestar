import BN from "bn.js";

// Serializable values

export type Uint = number | BN;
export type Bool = boolean;
export type Bytes = Buffer | Uint8Array;
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SerializableArray extends Array<SerializableValue> {}
export interface SerializableObject {
  [field: string]: SerializableValue;
}
export type SerializableValue = Uint | Bool | Bytes | SerializableArray | SerializableObject;

// Simple types
// These types are supplied to provide a convenient interface with which to specify types

export type SimplePrimitiveType = string;

export interface SimpleListType extends Array<AnySSZType> {
  0: AnySSZType;
}

export interface SimpleVectorType extends Array<AnySSZType | number> {
  0: AnySSZType;
  1: number;
}

export interface SimpleContainerType {
  name: string;
  fields: [string, AnySSZType][];
}

export type SimpleSSZType = SimplePrimitiveType | SimpleListType | SimpleVectorType | SimpleContainerType;

// Full types
// These types are used internally

export enum Type {
  uint,
  bool,
  byteList,
  byteVector,
  list,
  vector,
  container,
}

export interface UintType {
  type: Type.uint;
  byteLength: number;
  offset: number | BN;
  useNumber: boolean;
}

export interface BoolType {
  type: Type.bool;
}

export interface ByteListType {
  type: Type.byteList;
}

export interface ByteVectorType {
  type: Type.byteVector;
  length: number;
}

export type BytesType = ByteListType | ByteVectorType;

export interface ListType {
  type: Type.list;
  elementType: FullSSZType;
}

export interface VectorType {
  type: Type.vector;
  elementType: FullSSZType;
  length: number;
}

export type ArrayType = ListType | VectorType;

export interface ContainerType {
  type: Type.container;
  name: string;
  fields: [string, FullSSZType][];
}

export type FullSSZType = UintType | BoolType | BytesType | ArrayType | ContainerType;

// simple + full types

export type AnyContainerType = ContainerType | SimpleContainerType;

export type AnySSZType = FullSSZType | SimpleSSZType;
