import varint from "varint";
import {source} from "stream-to-it";
import snappy from "@chainsafe/snappy-stream";
import {EncodedPayload, EncodedPayloadType, TypeSerializer} from "../../types.js";
import {SszSnappyError, SszSnappyErrorCode} from "./errors.js";

/**
 * ssz_snappy encoding strategy writer.
 * Yields byte chunks for encoded header and payload as defined in the spec:
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function* writeSszSnappyPayload<T>(
  body: EncodedPayload<T>,
  type: TypeSerializer<T>
): AsyncGenerator<Buffer> {
  const serializedBody = serializeSszBody(body, type);

  yield* encodeSszSnappy(serializedBody);
}

/**
 * Buffered Snappy writer
 */
export async function* encodeSszSnappy(bytes: Buffer): AsyncGenerator<Buffer> {
  // MUST encode the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
  yield Buffer.from(varint.encode(bytes.length));

  // By first computing and writing the SSZ byte length, the SSZ encoder can then directly
  // write the chunk contents to the stream. Snappy writer compresses frame by frame

  /**
   * Use sync version (default) for compress as it is almost 2x faster than async
   * one and most payloads are "1 chunk" and 100kb payloads (which would mostly be
   * big bellatrix blocks with transactions) are just 2 chunks
   *
   * To use async version (for e.g. on big payloads) instantiate the stream with
   * `createCompressStream({asyncCompress: true})`
   */
  const stream = snappy.createCompressStream();
  stream.write(bytes);
  stream.end();
  yield* source<Buffer>(stream);
}

/**
 * Returns SSZ serialized body. Wrapps errors with SszSnappyError.SERIALIZE_ERROR
 */
function serializeSszBody<T>(chunk: EncodedPayload<T>, type: TypeSerializer<T>): Buffer {
  switch (chunk.type) {
    case EncodedPayloadType.bytes:
      return chunk.bytes as Buffer;

    case EncodedPayloadType.ssz: {
      try {
        const bytes = type.serialize(chunk.data);
        return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length);
      } catch (e) {
        throw new SszSnappyError({code: SszSnappyErrorCode.SERIALIZE_ERROR, serializeError: e as Error});
      }
    }
  }
}
