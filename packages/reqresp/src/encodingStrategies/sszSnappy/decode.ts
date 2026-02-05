import type {MessageStream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {decode as varintDecode, encodingLength as varintEncodingLength} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {TypeSizes} from "../../types.js";
import {SnappyFramesUncompress} from "../../utils/snappyIndex.js";
import {SszSnappyError, SszSnappyErrorCode} from "./errors.js";
import {maxEncodedLen} from "./utils.js";

export const MAX_VARINT_BYTES = 10;

// Snappy frame header size (1 byte type + 3 bytes length)
const SNAPPY_FRAME_HEADER_SIZE = 4;

/**
 * Wraps byteStream read to convert libp2p errors to SszSnappyError.
 */
async function safeRead(
  bytes: ByteStream<MessageStream>,
  options: {bytes: number; signal?: AbortSignal}
): Promise<Uint8ArrayList> {
  try {
    return await bytes.read(options);
  } catch (e) {
    // Handle UnexpectedEOFError from @libp2p/utils and other stream closed errors
    const message = (e as Error).message || "";
    if (
      message.includes("EOF") ||
      message.includes("closed") ||
      message.includes("ended") ||
      (e as Error).name === "UnexpectedEOFError"
    ) {
      throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
    }
    throw e;
  }
}

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
    const byte = await safeRead(bytes, {bytes: 1, signal});
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
 * Uses precise frame-by-frame reading to avoid consuming bytes from the next response chunk.
 *
 * Snappy frame format:
 * - 1 byte chunk type
 * - 3 bytes little-endian length
 * - length bytes of frame data
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

  // Read and decompress snappy frames until we have enough uncompressed data
  while (uncompressedData.length < sszDataLength) {
    // Read snappy frame header (4 bytes: 1 type + 3 length)
    const header = await safeRead(bytes, {bytes: SNAPPY_FRAME_HEADER_SIZE, signal});
    totalReadBytes += SNAPPY_FRAME_HEADER_SIZE;

    // Check max bytes limit
    if (totalReadBytes > maxBytes) {
      throw new SszSnappyError({
        code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
        readBytes: totalReadBytes,
        sszDataLength,
      });
    }

    // Parse frame length from header (3 bytes little-endian at offset 1)
    const frameLength = header.get(1) + (header.get(2) << 8) + (header.get(3) << 16);

    // Read frame data
    let frameData: Uint8ArrayList;
    if (frameLength > 0) {
      frameData = await safeRead(bytes, {bytes: frameLength, signal});
      totalReadBytes += frameLength;

      // Check max bytes limit again after reading frame data
      if (totalReadBytes > maxBytes) {
        throw new SszSnappyError({
          code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
          readBytes: totalReadBytes,
          sszDataLength,
        });
      }
    } else {
      frameData = new Uint8ArrayList();
    }

    // Combine header and frame data for decompressor
    const fullFrame = new Uint8ArrayList(header, frameData);

    // Decompress the complete frame
    try {
      const uncompressed = decompressor.uncompress(fullFrame);
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
