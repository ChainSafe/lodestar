import {Type, FullSSZType} from "@chainsafe/ssz";

/**
 * Transform the type to something that is safe to deserialize
 *
 * This mainly entails making sure all numbers are bignumbers
 */
export function safeType(type: FullSSZType): FullSSZType {
  switch (type.type) {
    case Type.uint:
      return {
        ...type,
        use: "bigint",
      };
    case Type.list:
    case Type.vector:
      return {
        ...type,
        elementType: safeType(type.elementType),
      };
    case Type.container:
      return {
        ...type,
        fields: type.fields.map(([fieldName, fieldType]) => ([fieldName, safeType(fieldType)])),
      };
    default:
      return type;
  }
}
