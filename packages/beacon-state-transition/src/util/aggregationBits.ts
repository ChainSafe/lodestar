import {BitList, BitListType, BitVector, isTreeBacked, TreeBacked, Type} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";

const BITS_PER_BYTE = 8;
/** Globally cache this information. @see getUint8ByteToBitBooleanArray */
const uint8ByteToBitBooleanArrays: boolean[][] = [];

/**
 * Given a byte (0 -> 255), return a Array of boolean with length = 8, big endian.
 * Ex: 1 => [true false false false false false false false]
 *     5 => [true false true false false fase false false]
 */
export function getUint8ByteToBitBooleanArray(byte: number): boolean[] {
  if (!uint8ByteToBitBooleanArrays[byte]) {
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
  return zipIndexes(indexes, bits, ssz.phase0.CommitteeBits);
}
/** zipIndexes for SyncCommitteeBits. @see zipIndexes */
export function zipIndexesSyncCommitteeBits(indexes: number[], bits: TreeBacked<BitVector> | BitVector): number[] {
  return zipIndexes(indexes, bits, ssz.altair.SyncCommitteeBits);
}

/**
 * Performant indexing of a BitList, both as struct or TreeBacked
 * @see zipIndexesInBitListTreeBacked
 */
export function zipIndexes<BitArr extends BitList | BitVector>(
  indexes: number[],
  bitlist: TreeBacked<BitArr> | BitArr,
  sszType: Type<BitArr>
): number[] {
  if (isTreeBacked<BitArr>(bitlist)) {
    return zipIndexesTreeBacked(indexes, bitlist, sszType);
  } else {
    const attestingIndices = [];
    for (let i = 0, len = indexes.length; i < len; i++) {
      if (bitlist[i]) {
        attestingIndices.push(indexes[i]);
      }
    }
    return attestingIndices;
  }
}

/**
 * Returns a new `indexes` array with only the indexes that participated in `bitlist`.
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
): number[] {
  const bytes = bitsToUint8Array(bits, sszType);

  const indexesSelected: number[] = [];

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
      const participantIndex = indexes[iByte * BITS_PER_BYTE + iBit];
      if (booleansInByte[iBit] && participantIndex !== undefined) {
        indexesSelected.push(participantIndex);
      }
    }
  }

  return indexesSelected;
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
