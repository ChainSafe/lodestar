import BN from "bn.js";

// Serializable values

export type Uint = number | BN;
export type Bool = boolean;
export type ByteArray = Buffer | Uint8Array;
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface SerializableList extends Array<SerializableValue> {}
export type SerializableArray = ByteArray | SerializableList;
export interface SerializableObject {
  [field: string]: SerializableValue;
}
export type SerializableValue = Uint | Bool | SerializableArray | SerializableObject;

export interface DeserializedValue {
  offset: number;
  value: SerializableValue;
}

// Serializable types

export type PrimitiveType = string;
export interface ListType extends Array<SerializableType> {
  0: SerializableType;
}
export interface TupleType extends Array<SerializableType | number> {
  0: SerializableType;
  1: number;
}
export type ArrayType = ListType | TupleType;
export interface ObjectType {
  name: string;
  fields: [string, SerializableType][];
}
export type CompositeType = ArrayType | ObjectType;
export type SerializableType = PrimitiveType | CompositeType;
