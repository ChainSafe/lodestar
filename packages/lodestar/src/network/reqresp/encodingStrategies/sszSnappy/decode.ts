import BufferList from "bl";
import varint from "varint";
import {CompositeType} from "@chainsafe/ssz";
import {MAX_VARINT_BYTES} from "../../../../constants";
import {BufferedSource} from "../../utils";
import {RequestOrResponseType, RequestOrIncomingResponseBody} from "../../types";
import {SnappyFramesUncompress} from "./snappyFrames/uncompress";
import {maxEncodedLen} from "./utils";
import {SszSnappyError, SszSnappyErrorCode} from "./errors";

export interface ISszSnappyOptions {
  deserializeToTree?: boolean;
}

/**
 * ssz_snappy encoding strategy reader.
 * Consumes a stream source to read encoded header and payload as defined in the spec:
 * ```bnf
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function readSszSnappyPayload<T extends RequestOrIncomingResponseBody>(
  bufferedSource: BufferedSource,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): Promise<T> {
  const sszDataLength = await readSszSnappyHeader(bufferedSource, type);

  const bytes = await readSszSnappyBody(bufferedSource, sszDataLength);
  return deserializeSszBody<T>(bytes, type, options);
}

/**
 * Reads `<encoding-dependent-header>` for ssz-snappy.
 * encoding-header ::= the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
 */
async function readSszSnappyHeader(bufferedSource: BufferedSource, type: RequestOrResponseType): Promise<number> {
  for await (const buffer of bufferedSource) {
    // Get next bytes if empty
    if (buffer.length === 0) {
      continue;
    }

    // Use Number.MAX_SAFE_INTEGER to guard against this check https://github.com/chrisdickinson/varint/pull/20
    // On varint v6 if the number is > Number.MAX_SAFE_INTEGER `varint.decode` throws.
    // Since MAX_VARINT_BYTES = 10, this will always be the case for the condition below.
    // The check for MAX_VARINT_BYTES is kept for completeness
    let sszDataLength: number;
    try {
      sszDataLength = varint.decode(buffer.slice());
    } catch (e) {
      throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: Infinity});
    }

    // MUST validate: the unsigned protobuf varint used for the length-prefix MUST not be longer than 10 bytes
    // Check for varintBytes > 0 to guard against NaN, or 0 values
    const varintBytes = varint.decode.bytes;
    if (varintBytes > MAX_VARINT_BYTES || !(varintBytes > 0)) {
      throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes});
    }
    buffer.consume(varintBytes);

    // MUST validate: the length-prefix is within the expected size bounds derived from the payload SSZ type.
    const minSize = type.getMinSerializedLength();
    const maxSize = type.getMaxSerializedLength();
    if (sszDataLength < minSize) {
      throw new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
    }
    if (sszDataLength > maxSize) {
      throw new SszSnappyError({code: SszSnappyErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
    }

    return sszDataLength;
  }

  throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
}

/**
 * Reads `<encoded-payload>` for ssz-snappy and decompress.
 * The returned bytes can be SSZ deseralized
 */
async function readSszSnappyBody(bufferedSource: BufferedSource, sszDataLength: number): Promise<Buffer> {
  const decompressor = new SnappyFramesUncompress();
  const uncompressedData = new BufferList();
  let readBytes = 0;

  for await (const buffer of bufferedSource) {
    // SHOULD NOT read more than max_encoded_len(n) bytes after reading the SSZ length-prefix n from the header
    readBytes += buffer.length;
    if (readBytes > maxEncodedLen(sszDataLength)) {
      throw new SszSnappyError({code: SszSnappyErrorCode.TOO_MUCH_BYTES_READ, readBytes, sszDataLength});
    }

    // No bytes left to consume, get next
    if (buffer.length === 0) {
      continue;
    }

    // stream contents can be passed through a buffered Snappy reader to decompress frame by frame
    try {
      const uncompressed = decompressor.uncompress(buffer.slice());
      buffer.consume(buffer.length);
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

    // Keep reading chunks until `n` SSZ bytes
    if (uncompressedData.length < sszDataLength) {
      continue;
    }

    // buffer.length === n
    return uncompressedData.slice(0, sszDataLength);
  }

  // SHOULD consider invalid: An early EOF before fully reading the declared length-prefix worth of SSZ bytes
  throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
}

/**
 * Deseralizes SSZ body.
 * `isSszTree` option allows the SignedBeaconBlock type to be deserialized as a tree
 */
function deserializeSszBody<T extends RequestOrIncomingResponseBody>(
  bytes: Buffer,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): T {
  try {
    if (options?.deserializeToTree) {
      const typeTree = (type as unknown) as CompositeType<Record<string, unknown>>;
      return (typeTree.createTreeBackedFromBytes(bytes) as unknown) as T;
    } else {
      return type.deserialize(bytes) as T;
    }
  } catch (e) {
    throw new SszSnappyError({code: SszSnappyErrorCode.DESERIALIZE_ERROR, deserializeError: e as Error});
  }
}
