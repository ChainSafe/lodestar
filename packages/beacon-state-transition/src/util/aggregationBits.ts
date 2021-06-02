import {BitList, BitListType, BitVectorType, TreeBacked} from "@chainsafe/ssz";

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

/**
 * Returns a new `indexes` array with only the indexes that participated in `bitlist`.
 * Participation of `indexes[i]` means that the bit at position `i` in `bitlist` is true.
 *
 * Previously we computed this information with `readonlyValues(TreeBacked<BitList>)`.
 * However this approach is very inneficient since the SSZ parsing of BitList is not optimized.
 * This function uses a precomputed array of booleans `Uint8 -> boolean[]` @see uint8ByteToBitBooleanArrays.
 * This approach is x15 times faster.
 */
export function zipIndexesInBitList(
  indexes: number[],
  bitlist: TreeBacked<BitList>,
  sszType: BitVectorType | BitListType
): number[] {
  const attBytes = bitlistToUint8Array(bitlist as TreeBacked<BitList>, sszType);

  const indexesSelected: number[] = [];

  // Iterate over each byte of bitlist
  for (let iByte = 0, byteLen = attBytes.length; iByte < byteLen; iByte++) {
    // Get the precomputed boolean array for this byte
    const booleansInByte = getUint8ByteToBitBooleanArray(attBytes[iByte]);
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
 * @see zipIndexesInBitList for reasoning and advantatges.
 */
export function bitlistToUint8Array(
  aggregationBits: TreeBacked<BitList>,
  sszType: BitVectorType | BitListType
): Uint8Array {
  const tree = aggregationBits.tree;
  const chunkCount = sszType.tree_getChunkCount(tree);
  const chunkDepth = sszType.getChunkDepth();
  const nodeIterator = tree.iterateNodesAtDepth(chunkDepth, 0, chunkCount);
  const chunks: Uint8Array[] = [];
  for (const node of nodeIterator) {
    chunks.push(node.root);
  }
  // the last chunk has 32 bytes but we don't use all of them
  return Buffer.concat(chunks).subarray(0, Math.ceil(aggregationBits.length / BITS_PER_BYTE));
}
