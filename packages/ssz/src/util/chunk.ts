/** @module ssz */
import {
  FullSSZType,
  isBasicType,
  SerializableValue,
  Type,
} from "@chainsafe/ssz-type-schema";

import {fixedSize, size} from "../core/size";
import {_serialize} from "../core/serialize";

import {BYTES_PER_CHUNK} from "./constants";
import {byte} from "./types";

/** @ignore */
export function pack (input: SerializableValue[], type: FullSSZType): Buffer[] {
  if (input.length === 0) {
    return [];
  }
  // Serialize inputs into one long buffer
  const packedLength = input.map((v) => size(v, type)).reduce((a, b) => a + b, 0);
  const packedBuf = Buffer.alloc(packedLength);
  let index = 0;
  for (const v of input) {
    index = _serialize(v, type, packedBuf, index);
  }
  return chunkify(packedBuf);
}

/** @ignore */
export function chunkify (input: Buffer): Buffer[] {
  const chunkLength = Math.max(Math.ceil(input.length / BYTES_PER_CHUNK), 1);
  // Chop buffer into chunks
  const chunks = Array.from({length: chunkLength},
    (_, i) => input.slice(i * BYTES_PER_CHUNK, i * BYTES_PER_CHUNK + BYTES_PER_CHUNK));
  const lastChunk = chunks[chunkLength - 1];
  if (lastChunk.length < BYTES_PER_CHUNK) {
    chunks[chunkLength - 1] = Buffer.concat([lastChunk, Buffer.alloc(BYTES_PER_CHUNK - lastChunk.length)]);
  }
  return chunks;
}

/**
 * Return the number of bytes in a basic type, or 32 (a full hash) for compound types.
 */
export function itemLength(type: FullSSZType): number {
  if (isBasicType(type)) {
    return fixedSize(type);
  } else {
    return 32;
  }
}

/**
 * Return the number of hashes needed to represent the top-level elements in the given type
 * In all cases except lists/vectors of basic types, this is simply the number of top-level
 * elements, as each element gets one hash. For lists/vectors of basic types, it is often
 * fewer because multiple basic elements
 */
export function chunkCount(type: FullSSZType): number {
  switch (type.type) {
    case Type.uint:
    case Type.bool:
      return 1;
    case Type.bitList:
      return Math.floor((type.maxLength + 255) / 256);
    case Type.bitVector:
      return Math.floor((type.length + 255) / 256);
    case Type.byteList:
      return Math.floor((type.maxLength * itemLength(byte) + 31) / 32);
    case Type.byteVector:
      return Math.floor((type.length * itemLength(byte) + 31) / 32);
    case Type.list:
      return Math.floor((type.maxLength * itemLength(type.elementType) + 31) / 32);
    case Type.vector:
      return Math.floor((type.length * itemLength(type.elementType) + 31) / 32);
    case Type.container:
      return type.fields.length;
    default:
      throw new Error("unsupported type");
  }
}
