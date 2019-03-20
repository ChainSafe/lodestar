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

export interface DeserializedValue {
  offset: number;
  value: SerializableValue;
}

// Simplified types
// These types are supplied to provide a convenient interface with which to specify types

export type SimplifiedPrimitiveType = string;

export interface SimplifiedListType extends Array<SimplifiedType> {
  0: SimplifiedType;
}

export interface SimplifiedVectorType extends Array<SimplifiedType | number> {
  0: SimplifiedType;
  1: number;
}

export interface SimplifiedContainerType {
  name: string;
  fields: [string, SimplifiedType][];
}

export type SimplifiedType = SimplifiedPrimitiveType | SimplifiedListType | SimplifiedPrimitiveType | SimplifiedContainerType;

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
  offset: number;
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
  elementType: SSZType;
}

export interface VectorType {
  type: Type.vector;
  elementType: SSZType;
  length: number;
}

export type ArrayType = ListType | VectorType;

export interface ContainerType {
  type: Type.container;
  name: string;
  fields: [string, SSZType][];
}

export type SSZType = UintType | BoolType | BytesType | ArrayType | ContainerType;

export type AnyContainerType = ContainerType | SimplifiedContainerType;

export type AnyType = SSZType | SimplifiedType;
