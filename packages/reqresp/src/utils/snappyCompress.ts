// snappy is better for compression for larger payloads
import {compressSync} from "snappy";
import {Uint8ArrayList} from "uint8arraylist";
import {ChunkType, IDENTIFIER_FRAME, UNCOMPRESSED_CHUNK_SIZE, crc} from "./snappyCommon.js";

/**
 * Encodes data into snappy framing format synchronously.
 * Returns a Uint8ArrayList containing all snappy frames.
 */
export function encodeSnappyFrames(bytes: Uint8Array): Uint8ArrayList {
  const result = new Uint8ArrayList();

  // Add identifier frame
  result.append(IDENTIFIER_FRAME);

  // Process data in chunks
  for (let i = 0; i < bytes.length; i += UNCOMPRESSED_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + UNCOMPRESSED_CHUNK_SIZE);
    // snappy types expect Buffer, convert Uint8Array
    const compressed = compressSync(Buffer.from(chunk));

    if (compressed.length < chunk.length) {
      // Use compressed chunk
      const size = compressed.length + 4;
      const header = new Uint8Array([ChunkType.COMPRESSED, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff]);
      result.append(header);
      result.append(crc(chunk));
      result.append(compressed);
    } else {
      // Use uncompressed chunk (compression didn't help)
      const size = chunk.length + 4;
      const header = new Uint8Array([ChunkType.UNCOMPRESSED, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff]);
      result.append(header);
      result.append(crc(chunk));
      result.append(chunk);
    }
  }

  return result;
}
