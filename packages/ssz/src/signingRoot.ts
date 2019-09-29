/** @module ssz */
import assert from "assert";

import {AnyContainerType, ContainerType, Type, copyType, parseType} from "@chainsafe/ssz-type-schema";

import {hashTreeRoot} from "./hashTreeRoot";

/**
 * [[hashTreeRoot]] an SSZ object w/o its last field
 *
 * This is useful if we assume the final field is a signature.
 * Used for signing/verifying signed data
 *
 * ```typescript
 * interface myData {
 *   a: number;
 *   b: boolean;
 *   c: Buffer; // <- signature
 * }
 * const myDataType: SimpleContainerType = {
 *   fields: [
 *     ["a", "uint16"],
 *     ["b", "bool"],
 *     ["c", "bytes96"],
 *   ],
 * };
 * let d: myData = {
 *   a: 5,
 *   b: false,
 *   c: Buffer.alloc(0),
 * };
 *
 * // create the signing root
 * const root: Buffer = signingRoot(d, myDataType);
 *
 * // sign the signing root, store as the final field
 * d.c = sign(privateKey, root); // hypothetical `sign` function
 *
 * // if others receive `d`, they can verify the signature
 * verify(publicKey, signingRoot(d, myDataType), d.c); // hypothetical `verify` function
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function signingRoot(value: any, type: AnyContainerType): Buffer {
  const _type = parseType(type);
  assert(_type.type === Type.container);
  const truncatedType = copyType(_type) as ContainerType;
  truncatedType.fields.pop();
  return hashTreeRoot(value, truncatedType);
}
