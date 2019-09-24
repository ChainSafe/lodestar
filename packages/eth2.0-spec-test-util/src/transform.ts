import {Type, FullSSZType} from "@chainsafe/ssz";

/**
 * Transform the type to something that is safe to deserialize
 *
 * This mainly entails making sure all numbers are bignumbers
 */
export function transformType(type: FullSSZType): FullSSZType {
  switch (type.type) {
    case Type.uint:
      return {
        ...type,
        useNumber: false,
      };
    case Type.list:
    case Type.vector:
      return {
        ...type,
        elementType: transformType(type.elementType),
      };
    case Type.container:
      return {
        ...type,
        fields: type.fields.map(([fieldName, fieldType]) => ([fieldName, transformType(fieldType)])),
      };
    default:
      return type;
  }
}
