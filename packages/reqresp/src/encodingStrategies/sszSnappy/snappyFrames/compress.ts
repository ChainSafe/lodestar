import snappy from "snappy";
import {ChunkType, IDENTIFIER_FRAME, UNCOMPRESSED_CHUNK_SIZE, crc} from "./common.js";

// The logic in this file is largely copied (in simplified form) from https://github.com/ChainSafe/node-snappy-stream/

export async function* encodeSnappy(bytes: Buffer): AsyncGenerator<Buffer> {
  yield IDENTIFIER_FRAME;

  for (let i = 0; i < bytes.length; i += UNCOMPRESSED_CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + UNCOMPRESSED_CHUNK_SIZE);
    const compressed = snappy.compressSync(chunk);
    if (compressed.length < chunk.length) {
      const size = compressed.length + 4;
      yield Buffer.concat([Buffer.from([ChunkType.COMPRESSED, size, size >> 8, size >> 16]), crc(chunk), compressed]);
    } else {
      const size = chunk.length + 4;
      yield Buffer.concat([
        //
        Buffer.from([ChunkType.UNCOMPRESSED, size, size >> 8, size >> 16]),
        crc(chunk),
        chunk,
      ]);
    }
  }
}
