/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

import {
  Type,
  UintNumberType,
  UintBigintType,
  ContainerType,
  ListBasicType,
  ListCompositeType,
  VectorBasicType,
  VectorCompositeType,
} from "@chainsafe/ssz";

/**
 * Transform the type to something that is safe to deserialize
 *
 * This mainly entails making sure all numbers are bignumbers
 */
export function replaceUintTypeWithUintBigintType<T extends Type<any>>(type: T): T {
  if (type instanceof UintNumberType && type.byteLength === 8) {
    return (new UintBigintType(type.byteLength) as unknown) as T;
  }

  // For Container iterate and replace all sub properties
  if (type instanceof ContainerType) {
    const fields = {...type.fields};
    for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
      fields[key] = replaceUintTypeWithUintBigintType(fields[key]);
    }
    return (new ContainerType(fields, type.opts) as unknown) as T;
  }

  // For List or vectors replace the subType
  if (type instanceof ListBasicType) {
    return (new ListBasicType(replaceUintTypeWithUintBigintType(type.elementType), type.limit) as unknown) as T;
  }
  if (type instanceof VectorBasicType) {
    return (new VectorBasicType(replaceUintTypeWithUintBigintType(type.elementType), type.length) as unknown) as T;
  }
  if (type instanceof ListCompositeType) {
    return (new ListCompositeType(replaceUintTypeWithUintBigintType(type.elementType), type.limit) as unknown) as T;
  }
  if (type instanceof VectorCompositeType) {
    return (new VectorCompositeType(replaceUintTypeWithUintBigintType(type.elementType), type.length) as unknown) as T;
  }

  return type;
}
