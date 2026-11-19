import type {Stream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {decode as varintDecode, encodingLength as varintEncodingLength} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {TypeSizes} from "../../types.js";
import {ChunkType, decodeSnappyFrameData, parseSnappyFrameHeader} from "../../utils/snappyIndex.js";
import {SszSnappyError, SszSnappyErrorCode} from "./errors.js";
import {maxEncodedLen} from "./utils.js";

export const MAX_VARINT_BYTES = 10;

/**
 * ssz_snappy encoding strategy reader.
 * Consumes a stream source to read encoded header and payload as defined in the spec:
 * ```bnf
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function readSszSnappyPayload(
  stream: ByteStream<Stream>,
  type: TypeSizes,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const sszDataLength = await readSszSnappyHeader(stream, type, signal);

  return readSszSnappyBody(stream, sszDataLength, signal);
}

/**
 * Reads `<encoding-dependent-header>` for ssz-snappy.
 * encoding-header ::= the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
 */
export async function readSszSnappyHeader(
  stream: ByteStream<Stream>,
  type: TypeSizes,
  signal?: AbortSignal
): Promise<number> {
  const varintBytes: number[] = [];

  while (true) {
    const byte = await readExactOrSourceAborted(stream, 1, signal);

    const value = byte.get(0);

    varintBytes.push(value);
    if (varintBytes.length > MAX_VARINT_BYTES) {
      throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes.length});
    }

    // MSB not set => varint terminated
    if ((value & 0x80) === 0) break;
  }

  let sszDataLength: number;
  try {
    sszDataLength = varintDecode(Uint8Array.from(varintBytes));
  } catch {
    throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: Infinity});
  }

  // MUST validate: the unsigned protobuf varint used for the length-prefix MUST not be longer than 10 bytes
  // encodingLength function only returns 1-8 inclusive
  const varintByteLength = varintEncodingLength(sszDataLength);
  if (varintByteLength > MAX_VARINT_BYTES) {
    throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintByteLength});
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
}

/**
 * Reads `<encoded-payload>` for ssz-snappy and decompress.
 * The returned bytes can be SSZ deseralized
 */
export async function readSszSnappyBody(
  stream: ByteStream<Stream>,
  sszDataLength: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const uncompressedData = new Uint8ArrayList();
  let encodedBytesRead = 0;
  const maxBytes = maxEncodedLen(sszDataLength);
  let foundIdentifier = false;

  while (uncompressedData.length < sszDataLength) {
    const header = await readExactOrSourceAborted(stream, 4, signal);

    // SHOULD NOT read more than max_encoded_len(n) bytes after reading the SSZ length-prefix n from the header
    encodedBytesRead = addEncodedBytesReadOrThrow(encodedBytesRead, header.length, maxBytes, sszDataLength);

    let headerParsed: {type: ChunkType; frameSize: number};
    try {
      headerParsed = parseSnappyFrameHeader(header.subarray());
      if (!foundIdentifier && headerParsed.type !== ChunkType.IDENTIFIER) {
        throw new Error("malformed input: must begin with an identifier");
      }
    } catch (e) {
      throw new SszSnappyError({code: SszSnappyErrorCode.DECOMPRESSOR_ERROR, decompressorError: e as Error});
    }

    if (headerParsed.frameSize > maxBytes - encodedBytesRead) {
      throw new SszSnappyError({
        code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ,
        readBytes: encodedBytesRead + headerParsed.frameSize,
        sszDataLength,
      });
    }
    const frame = await readExactOrSourceAborted(stream, headerParsed.frameSize, signal);

    encodedBytesRead = addEncodedBytesReadOrThrow(encodedBytesRead, frame.length, maxBytes, sszDataLength);

    try {
      if (headerParsed.type === ChunkType.IDENTIFIER) {
        foundIdentifier = true;
      }

      const uncompressed = decodeSnappyFrameData(headerParsed.type, frame.subarray());
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

  // buffer.length === n
  return uncompressedData.subarray(0, sszDataLength);
}

function addEncodedBytesReadOrThrow(
  encodedBytesRead: number,
  bytesToAdd: number,
  maxBytes: number,
  sszDataLength: number
): number {
  const nextReadBytes = encodedBytesRead + bytesToAdd;
  if (nextReadBytes > maxBytes) {
    throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ, readBytes: nextReadBytes, sszDataLength});
  }
  return nextReadBytes;
}

async function readExactOrSourceAborted(
  stream: ByteStream<Stream>,
  bytes: number,
  signal?: AbortSignal
): Promise<Uint8ArrayList> {
  return stream.read({bytes, signal}).catch((e) => {
    if ((e as Error).name === "UnexpectedEOFError") {
      throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
    }
    throw e;
  });
}
