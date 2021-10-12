import {BitList, BitListType, BitVector, isTreeBacked, TreeBacked, Type} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

const BITS_PER_BYTE = 8;
/** Globally cache this information. @see getUint8ByteToBitBooleanArray */
const uint8ByteToBitBooleanArrays: boolean[][] = [];

/**
 * Given a byte (0 -> 255), return a Array of boolean with length = 8, big endian.
 * Ex: 1 => [true false false false false false false false]
 *     5 => [true false true false false fase false false]
 */
export function getUint8ByteToBitBooleanArray(byte: number): boolean[] {
  if (uint8ByteToBitBooleanArrays[byte] === undefined) {
    uint8ByteToBitBooleanArrays[byte] = computeUint8ByteToBitBooleanArray(byte);
  }
  return uint8ByteToBitBooleanArrays[byte];
}

/** @see getUint8ByteToBitBooleanArray */
function computeUint8ByteToBitBooleanArray(byte: number): boolean[] {
  // this returns little endian
  const binaryStr = byte.toString(2);
  const binaryLength = binaryStr.length;
  return Array.from({length: BITS_PER_BYTE}, (_, j) => {
    if (j < binaryLength) {
      return binaryStr[binaryLength - j - 1] === "1" ? true : false;
    } else {
      return false;
    }
  });
}

/** zipIndexes for CommitteeBits. @see zipIndexes */
export function zipIndexesCommitteeBits(indexes: number[], bits: TreeBacked<BitVector> | BitVector): number[] {
  return zipIndexes(indexes, bits, ssz.phase0.CommitteeBits)[0];
}

/** zipIndexes for SyncCommitteeBits. @see zipIndexes */
export function zipIndexesSyncCommitteeBits(indexes: number[], bits: TreeBacked<BitVector> | BitVector): number[] {
  return zipIndexes(indexes, bits, ssz.altair.SyncCommitteeBits)[0];
}

/** Similar to zipIndexesSyncCommitteeBits but we extract both participant and unparticipant indices*/
export function zipAllIndexesSyncCommitteeBits(
  indexes: number[],
  bits: TreeBacked<BitVector> | BitVector
): [number[], number[]] {
  return zipIndexes(indexes, bits, ssz.altair.SyncCommitteeBits);
}

/**
 * Performant indexing of a BitList, both as struct or TreeBacked
 * Return [0] as participant indices and [1] as unparticipant indices
 * @see zipIndexesInBitListTreeBacked
 */
export function zipIndexes<BitArr extends BitList | BitVector>(
  indexes: number[],
  bitlist: TreeBacked<BitArr> | BitArr,
  sszType: Type<BitArr>
): [number[], number[]] {
  if (isTreeBacked<BitArr>(bitlist)) {
    return zipIndexesTreeBacked(indexes, bitlist, sszType);
  } else {
    const attestingIndices = [];
    const unattestingIndices = [];
    for (let i = 0, len = indexes.length; i < len; i++) {
      if (bitlist[i]) {
        attestingIndices.push(indexes[i]);
      } else {
        unattestingIndices.push(indexes[i]);
      }
    }
    return [attestingIndices, unattestingIndices];
  }
}

/**
 * Returns [0] as indices that participated in `bitlist` and [1] as indices that did not participated in `bitlist`.
 * Participation of `indexes[i]` means that the bit at position `i` in `bitlist` is true.
 *
 * Previously we computed this information with `readonlyValues(TreeBacked<BitList>)`.
 * However this approach is very inneficient since the SSZ parsing of BitList is not optimized.
 * This function uses a precomputed array of booleans `Uint8 -> boolean[]` @see uint8ByteToBitBooleanArrays.
 * This approach is x15 times faster.
 */
export function zipIndexesTreeBacked<BitArr extends BitList | BitVector>(
  indexes: number[],
  bits: TreeBacked<BitArr>,
  sszType: Type<BitArr>
): [number[], number[]] {
  const bytes = bitsToUint8Array(bits, sszType);

  const participantIndices: number[] = [];
  const unparticipantIndices: number[] = [];

  // Iterate over each byte of bits
  for (let iByte = 0, byteLen = bytes.length; iByte < byteLen; iByte++) {
    // Get the precomputed boolean array for this byte
    const booleansInByte = getUint8ByteToBitBooleanArray(bytes[iByte]);
    // For each bit in the byte check participation and add to indexesSelected array
    for (let iBit = 0; iBit < BITS_PER_BYTE; iBit++) {
      const committeeIndex = indexes[iByte * BITS_PER_BYTE + iBit];
      if (committeeIndex !== undefined) {
        if (booleansInByte[iBit]) {
          participantIndices.push(committeeIndex);
        } else {
          unparticipantIndices.push(committeeIndex);
        }
      }
    }
  }

  return [participantIndices, unparticipantIndices];
}

/**
 * Efficiently extract the Uint8Array inside a `TreeBacked<BitList>` structure.
 * @see zipIndexesInBitListTreeBacked for reasoning and advantatges.
 */
export function bitsToUint8Array<BitArr extends BitList | BitVector>(
  bits: TreeBacked<BitArr>,
  sszType: Type<BitArr>
): Uint8Array {
  const tree = bits.tree;
  const treeType = (sszType as unknown) as BitListType;
  const chunkCount = treeType.tree_getChunkCount(tree);
  const chunkDepth = treeType.getChunkDepth();
  const nodeIterator = tree.iterateNodesAtDepth(chunkDepth, 0, chunkCount);
  const chunks: Uint8Array[] = [];
  for (const node of nodeIterator) {
    chunks.push(node.root);
  }
  // the last chunk has 32 bytes but we don't use all of them
  return Buffer.concat(chunks).subarray(0, Math.ceil(bits.length / BITS_PER_BYTE));
}

/**
 * Variant to extract a single bit (for un-aggregated attestations)
 */
export function getSingleBitIndex(bits: BitList | TreeBacked<BitList>): number {
  let index: number | null = null;

  if (isTreeBacked<BitList>(bits)) {
    const bytes = bitsToUint8Array(bits, ssz.phase0.CommitteeBits);

    // Iterate over each byte of bits
    for (let iByte = 0, byteLen = bytes.length; iByte < byteLen; iByte++) {
      // If it's exactly zero, there won't be any indexes, continue early
      if (bytes[iByte] === 0) {
        continue;
      }

      // Get the precomputed boolean array for this byte
      const booleansInByte = getUint8ByteToBitBooleanArray(bytes[iByte]);
      // For each bit in the byte check participation and add to indexesSelected array
      for (let iBit = 0; iBit < BITS_PER_BYTE; iBit++) {
        if (booleansInByte[iBit] === true) {
          if (index !== null) throw new AggregationBitsError({code: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET});
          index = iByte * BITS_PER_BYTE + iBit;
        }
      }
    }
  } else {
    for (let i = 0, len = bits.length; i < len; i++) {
      if (bits[i] === true) {
        if (index !== null) throw new AggregationBitsError({code: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET});
        index = i;
      }
    }
  }

  if (index === null) {
    throw new AggregationBitsError({code: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET});
  } else {
    return index;
  }
}

export enum AggregationBitsErrorCode {
  NOT_EXACTLY_ONE_BIT_SET = "AGGREGATION_BITS_ERROR_NOT_EXACTLY_ONE_BIT_SET",
}

type AggregationBitsErrorType = {
  code: AggregationBitsErrorCode.NOT_EXACTLY_ONE_BIT_SET;
};

export class AggregationBitsError extends LodestarError<AggregationBitsErrorType> {}
