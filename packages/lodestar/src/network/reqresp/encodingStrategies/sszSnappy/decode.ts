import BufferList from "bl";
import varint from "varint";
import {CompositeType} from "@chainsafe/ssz";
import {MAX_VARINT_BYTES} from "../../../../constants";
import {SnappyFramesUncompress} from "../../../encoders/snappyFrames/uncompress";
import {BufferedSource} from "../../utils/bufferedSource";
import {RequestOrResponseType, RequestOrResponseBody} from "../../interface";
import {maxEncodedLen} from "./utils";
import {SszSnappyError, SszSnappyErrorCode} from "./errors";

export interface ISszSnappyOptions {
  isSszTree?: boolean;
}

export async function readSszSnappyChunk<T extends RequestOrResponseBody>(
  bufferedSource: BufferedSource,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): Promise<T> {
  const sszDataLength = await readSszSnappyHeader(bufferedSource);
  validateSszSizeBounds(sszDataLength, type);

  const bytes = await readSszSnappyPayload(bufferedSource, sszDataLength);
  return deserializeBody<T>(bytes, type, options);
}

async function readSszSnappyHeader(bufferedSource: BufferedSource): Promise<number> {
  for await (const buffer of bufferedSource) {
    // Get next bytes if empty
    if (buffer.length === 0) {
      continue;
    }

    // encoding-dependent-header for ssz_snappy
    // Header ::= the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
    const sszDataLength = varint.decode(buffer.slice());
    const varintBytes = varint.decode.bytes;
    if (varintBytes > MAX_VARINT_BYTES) {
      throw new SszSnappyError({code: SszSnappyErrorCode.INVALID_VARINT_BYTES_COUNT, bytes: varintBytes});
    }
    buffer.consume(varintBytes);

    return sszDataLength;
  }

  throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
}

function validateSszSizeBounds(sszDataLength: number, type: RequestOrResponseType): void {
  const minSize = type.minSize();
  const maxSize = type.maxSize();

  // MUST validate that the length-prefix is within the expected size bounds derived from the payload SSZ type.
  if (sszDataLength < minSize) {
    throw new SszSnappyError({code: SszSnappyErrorCode.UNDER_SSZ_MIN_SIZE, minSize, sszDataLength});
  }
  if (sszDataLength > maxSize) {
    throw new SszSnappyError({code: SszSnappyErrorCode.OVER_SSZ_MAX_SIZE, maxSize, sszDataLength});
  }
}

async function readSszSnappyPayload(bufferedSource: BufferedSource, sszDataLength: number): Promise<Buffer> {
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

    let uncompressed: Buffer | null = null;
    try {
      uncompressed = decompressor.uncompress(buffer.slice());
      buffer.consume(buffer.length);
    } catch (e) {
      throw new SszSnappyError({code: SszSnappyErrorCode.DECOMPRESSOR_ERROR, decompressorError: e});
    }

    if (uncompressed === null) {
      continue;
    }

    uncompressedData.append(uncompressed);

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

  throw new SszSnappyError({code: SszSnappyErrorCode.SOURCE_ABORTED});
}

function deserializeBody<T extends RequestOrResponseBody>(
  bytes: Buffer,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): T {
  try {
    if (options?.isSszTree) {
      return (((type as unknown) as CompositeType<Record<string, unknown>>).tree.deserialize(bytes) as unknown) as T;
    } else {
      return type.deserialize(bytes) as T;
    }
  } catch (e) {
    throw new SszSnappyError({code: SszSnappyErrorCode.DESERIALIZE_ERROR, deserializeError: e});
  }
}
