import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BitList, TreeBacked} from "@chainsafe/ssz";

const BITS_PER_BYTE = 8;
/**
 * Given a byte (0 -> 255), return a Array of boolean with length = 8, big endian.
 * Ex: 1 => [true false false false false false false false]
 *     5 => [true false true false false fase false false]
 */
const uint8ByteToBitBooleanArrays: boolean[][] = [];

export function getUint8ByteToBitBooleanArray(byte: number): boolean[] {
  if (!uint8ByteToBitBooleanArrays[byte]) {
    uint8ByteToBitBooleanArrays[byte] = computeUint8ByteToBitBooleanArray(byte);
  }
  return uint8ByteToBitBooleanArrays[byte];
}

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

export function zipIndexesInBitList(config: IBeaconConfig, indexes: number[], bitlist: TreeBacked<BitList>): number[] {
  const attBytes = bitlistToUint8Array(config, bitlist as TreeBacked<BitList>);

  const indexesSelected: number[] = [];

  // Iterate over each byte of bitlist
  for (let iByte = 0, byteLen = attBytes.length; iByte < byteLen; iByte++) {
    // Get the precomputed boolean array for this byte
    const booleansInByte = getUint8ByteToBitBooleanArray(attBytes[iByte]);
    // For each bit in the byte check participation and add to indexesSelected array
    for (let iBit = 0; iBit < BITS_PER_BYTE; iBit++) {
      if (booleansInByte[iBit]) {
        indexesSelected.push(indexes[iByte * BITS_PER_BYTE + iBit]);
      }
    }
  }

  return indexesSelected;
}

/**
 * readonlyValues returns Iterator<boolean> but there is a performance issue here.
 * This returns aggregation bytes from a TreeBacked aggregationBits which a significantly better performance.
 * Use getAggregationBit() to get a boolean value from a specific index.
 */
export function bitlistToUint8Array(config: IBeaconConfig, aggregationBits: TreeBacked<BitList>): Uint8Array {
  const sszType = config.types.phase0.CommitteeBits;
  const tree = aggregationBits.tree;
  const chunkCount = sszType.tree_getChunkCount(tree);
  const chunkDepth = sszType.getChunkDepth();
  const nodeIterator = tree.iterateNodesAtDepth(chunkDepth, 0, chunkCount);
  const chunks: Uint8Array[] = [];
  for (const node of nodeIterator) {
    chunks.push(node.root);
  }
  return Buffer.concat(chunks);
}
