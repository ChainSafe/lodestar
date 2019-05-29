/** @module ssz */
import assert from "assert";

import {
  AnyContainerType,
  ContainerType,
  Type,
} from "./types";

import { hashTreeRoot } from "./hashTreeRoot";

import {
  copyType,
  parseType,
} from "./util/types";

/**
 * Merkleize an SSZ object w/o its last field
 *
 * Used for signing/verifying signed data
 */
export function signingRoot(value: any, type: AnyContainerType): Buffer {
  const _type = parseType(type);
  assert(_type.type === Type.container);
  const truncatedType = copyType(_type) as ContainerType;
  truncatedType.fields.pop();
  return hashTreeRoot(value, truncatedType);
}
