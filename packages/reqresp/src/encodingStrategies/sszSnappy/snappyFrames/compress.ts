import snappy from "snappy";
import crc32c from "@chainsafe/fast-crc32c";
import {ChunkType, IDENTIFIER_FRAME} from "./common.js";

// The logic in this file is largely copied (in simplified form) from https://github.com/ChainSafe/node-snappy-stream/

/**
 * As per the snappy framing format for streams, the size of any uncompressed chunk can be
 * no longer than 65536 bytes.
 *
 * From: https://github.com/google/snappy/blob/main/framing_format.txt#L90:L92
 */
const UNCOMPRESSED_CHUNK_SIZE = 65536;

function checksum(value: Buffer): Buffer {
  const x = crc32c.calculate(value);
  const result = Buffer.allocUnsafe?.(4) ?? Buffer.alloc(4);

  // As defined in section 3 of https://github.com/google/snappy/blob/master/framing_format.txt
  // And other implementations for reference:
  // Go: https://github.com/golang/snappy/blob/2e65f85255dbc3072edf28d6b5b8efc472979f5a/snappy.go#L97
  // Python: https://github.com/andrix/python-snappy/blob/602e9c10d743f71bef0bac5e4c4dffa17340d7b3/snappy/snappy.py#L70
  // Mask the right hand to (32 - 17) = 15 bits -> 0x7fff, to keep correct 32 bit values.
  // Shift the left hand with >>> for correct 32 bit intermediate result.
  // Then final >>> 0 for 32 bits output
  result.writeUInt32LE((((x >>> 15) | ((x & 0x7fff) << 17)) + 0xa282ead8) >>> 0, 0);

  return result;
}

export async function* encodeSnappy(bytes: Buffer): AsyncGenerator<Buffer> {
  yield IDENTIFIER_FRAME;

  for (let i = 0; i < bytes.length; i += UNCOMPRESSED_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + UNCOMPRESSED_CHUNK_SIZE);
    const compressed = snappy.compressSync(chunk);
    if (compressed.length < chunk.length) {
      const size = compressed.length + 4;
      yield Buffer.concat([
        Buffer.from([ChunkType.COMPRESSED, size, size >> 8, size >> 16]),
        checksum(chunk),
        compressed,
      ]);
    } else {
      const size = chunk.length + 4;
      yield Buffer.concat([
        //
        Buffer.from([ChunkType.UNCOMPRESSED, size, size >> 8, size >> 16]),
        checksum(chunk),
        chunk,
      ]);
    }
  }
}
