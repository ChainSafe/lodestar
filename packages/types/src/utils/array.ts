import {ArrayType, ListBasicType, ListCompositeType, Type, isBasicType, isCompositeType} from "@chainsafe/ssz";

export function ArrayOf<T>(elementType: Type<T>, limit = Infinity): ArrayType<Type<T>, unknown, unknown> {
  if (isCompositeType(elementType)) {
    return new ListCompositeType(elementType, limit) as unknown as ArrayType<Type<T>, unknown, unknown>;
  }
  if (isBasicType(elementType)) {
    return new ListBasicType(elementType, limit) as unknown as ArrayType<Type<T>, unknown, unknown>;
  }
  throw Error(`Unknown type ${elementType.typeName}`);
}
