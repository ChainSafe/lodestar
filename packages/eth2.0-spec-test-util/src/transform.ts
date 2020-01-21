/* eslint-disable @typescript-eslint/no-explicit-any */
import {Type, UintType, BigIntUintType} from "@chainsafe/ssz";

/**
 * Transform the type to something that is safe to deserialize
 *
 * This mainly entails making sure all numbers are bignumbers
 */
export function safeType(type: Type<any>): Type<any> {
  if (type.isBasic()) {
    if ((type as UintType<any>).byteLength) {
      return new BigIntUintType({byteLength: (type as UintType<any>).byteLength});
    } else {
      return type;
    }
  } else {
    const props = {...type} as any;
    if (props.elementType) {
      props.elementType = safeType(props.elementType);
    }
    if (props.fields) {
      props.fields = props.fields.map(f => ([f[0], safeType(f[1])]));
    }
    return Object.create(Object.getPrototypeOf(type), props);
  }
}
