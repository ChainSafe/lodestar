import type {MessageStream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {decode as varintDecode, encodingLength as varintEncodingLength} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {TypeSizes} from "../../types.js";
import {SnappyFramesUncompress} from "../../utils/snappyIndex.js";
import {SszSnappyError, SszSnappyErrorCode} from "./errors.js";
import {maxEncodedLen} from "./utils.js";

export const MAX_VARINT_BYTES = 10;

/**
 * Reads and decodes an SSZ-snappy payload from stream using byteStream.
 * Wire format:
 * ```bnf
 * <varint-length> | <snappy-frames(ssz-payload)>
 * ```
 */
export async function decodeSszSnappyPayload(
  bytes: ByteStream<MessageStream>,
  type: TypeSizes,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const sszDataLength = await readSszSnappyHeader(bytes, type, signal);
  return readSszSnappyBody(bytes, sszDataLength, signal);
}

/**
 * Reads and validates the varint length prefix.
 */
async function readSszSnappyHeader(
  bytes: ByteStream<MessageStream>,
  type: TypeSizes,
  signal?: AbortSignal
): Promise<number> {
  // Read enough bytes for varint (up to 10 bytes, but usually 1-3)
  // Read incrementally to avoid over-reading
  const buffer = new Uint8ArrayList();

  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    const byte = await bytes.read({bytes: 1, signal});
    buffer.append(byte);

    try {
      const sszDataLength = varintDecode(buffer.subarray());

      // MUST validate: the unsigned protobuf varint used for the length-prefix MUST not be longer than 10 bytes
      const varintBytes = varintEncodingLength(sszDataLength);
      if (varintBytes > MAX_VARINT_BYTES) {
        throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes});
      }

      // MUST validate: the length-prefix is within the expected size bounds derived from the payload SSZ type.
      const minSize = type.minSize;
      const maxSize = type.maxSize;
      if (sszDataLength < minSize) {
        throw new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
      }
      if (sszDataLength > maxSize) {
        throw new SszSnappyError({code: SszSnappyErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
      }

      return sszDataLength;
    } catch (e) {
      // If not a varint decode error, rethrow
      if (e instanceof SszSnappyError) {
        throw e;
      }
      // Continue reading more bytes for varint
      // varint decode throws when not enough bytes
    }
  }

  throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: Infinity});
}

/**
 * Reads and decompresses snappy-framed SSZ data.
 */
async function readSszSnappyBody(
  bytes: ByteStream<MessageStream>,
  sszDataLength: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const decompressor = new SnappyFramesUncompress();
  const uncompressedData = new Uint8ArrayList();
  let totalReadBytes = 0;
  const maxBytes = maxEncodedLen(sszDataLength);

  // Read and decompress chunks until we have enough uncompressed data
  while (uncompressedData.length < sszDataLength) {
    // Calculate how much more we need to read
    // Read in reasonable chunks (4KB) but not more than allowed
    const remainingAllowed = maxBytes - totalReadBytes;
    if (remainingAllowed <= 0) {
      throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ, readBytes: totalReadBytes, sszDataLength});
    }

    const chunkSize = Math.min(4096, remainingAllowed);

    let chunk: Uint8ArrayList;
    try {
      chunk = await bytes.read({bytes: chunkSize, signal});
    } catch (e) {
      // Stream ended before we got all data
      if (uncompressedData.length < sszDataLength) {
        throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
      }
      break;
    }

    if (chunk.length === 0) {
      // Stream ended
      if (uncompressedData.length < sszDataLength) {
        throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
      }
      break;
    }

    totalReadBytes += chunk.length;

    // SHOULD NOT read more than max_encoded_len(n) bytes after reading the SSZ length-prefix n from the header
    if (totalReadBytes > maxBytes) {
      throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ, readBytes: totalReadBytes, sszDataLength});
    }

    // Decompress chunk
    try {
      const uncompressed = decompressor.uncompress(chunk);
      if (uncompressed !== null) {
        uncompressedData.append(uncompressed);
      }
    } catch (e) {
      throw new SszSnappyError({code: SszSnappyErrorCode.DECOMPRESSOR_ERROR, decompressorError: e as Error});
    }

    // SHOULD consider invalid reading more bytes than `n` SSZ bytes
    if (uncompressedData.length > sszDataLength) {
      throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MANY_BYTES, sszDataLength});
    }
  }

  // Return exactly the expected SSZ data
  return uncompressedData.subarray(0, sszDataLength);
}
