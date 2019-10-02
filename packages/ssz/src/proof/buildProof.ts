/* eslint-disable @typescript-eslint/no-explicit-any */
/** @module ssz */
import {BitList, BitVector} from "@chainsafe/bit-utils";
import {
  Bytes,
  ContainerType,
  FullSSZType,
  SerializableArray,
  SerializableObject,
  SerializableValue,
  Type,
  isBasicType,
} from "@chainsafe/ssz-type-schema";

import {_assertValidValue} from "../core/assertValidValue";

import {chunkCount, chunkify, pack} from "../util/chunk";
import {bitLength} from "../util/math";

import {merkleize, mixInLength} from "./util/merkleize";
import {GeneralizedIndex, IProofBuilder} from "./util/types";
import {child, concat} from "./util/generalizedIndex";

export function buildProof<T>(
  proofBuilder: IProofBuilder<T>,
  rootIndex: GeneralizedIndex,
  value: SerializableValue,
  type: FullSSZType
): Buffer {
  const firstChunkIndex = concat([rootIndex, 2n ** BigInt(bitLength(chunkCount(type) - 1))]);
  let elementType: FullSSZType;
  switch (type.type) {
    case Type.uint:
    case Type.bool:
    case Type.byteVector:
      return merkleize(proofBuilder, rootIndex, pack([value], type));
    case Type.bitVector:
      value = value as BitVector;
      return merkleize(proofBuilder, rootIndex, chunkify(Buffer.from(value.toBitfield())), chunkCount(type));
    case Type.bitList:
      value = value as BitList;
      return mixInLength(
        proofBuilder,
        rootIndex,
        merkleize(
          proofBuilder,
          child(rootIndex, false),
          chunkify(Buffer.from(value.toBitfield())),
          chunkCount(type)
        ),
        value.bitLength,
      );
    case Type.byteList:
      value = value as Bytes;
      return mixInLength(
        proofBuilder,
        rootIndex,
        merkleize(
          proofBuilder,
          child(rootIndex, false),
          pack([value], type),
          chunkCount(type)
        ),
        value.length
      );
    case Type.list:
      value = value as SerializableArray;
      elementType = type.elementType;
      if (isBasicType(elementType)) {
        return mixInLength(
          proofBuilder,
          rootIndex,
          merkleize(
            proofBuilder,
            child(rootIndex, false),
            pack(value, elementType),
            chunkCount(type)
          ),
          value.length
        );
      } else {
        return mixInLength(
          proofBuilder,
          rootIndex,
          merkleize(
            proofBuilder,
            child(rootIndex, false),
            value.map((v) => buildProof(proofBuilder, child(firstChunkIndex, false), v, elementType)),
            type.maxLength
          ),
          value.length
        );
      }
    case Type.vector:
      value = value as SerializableArray;
      elementType = type.elementType;
      if (isBasicType(elementType)) {
        return merkleize(
          proofBuilder,
          rootIndex,
          pack(value, elementType)
        );
      } else {
        return merkleize(
          proofBuilder,
          rootIndex,
          value.map((v, i) => buildProof(proofBuilder, firstChunkIndex + BigInt(i), v, elementType))
        );
      }
    case Type.container:
      type = type as ContainerType;
      return merkleize(
        proofBuilder,
        rootIndex,
        type.fields.map(([fieldName, fieldType], i) =>
          buildProof(proofBuilder, firstChunkIndex + BigInt(i), (value as SerializableObject)[fieldName], fieldType))
      );
  }
}
