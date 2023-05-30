import varint from "varint";
import {source} from "stream-to-it";
import snappy from "@chainsafe/snappy-stream";

/**
 * ssz_snappy encoding strategy writer.
 * Yields byte chunks for encoded header and payload as defined in the spec:
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function* writeSszSnappyPayload(bodyData: Uint8Array): AsyncGenerator<Buffer> {
  yield* encodeSszSnappy(bodyData as Buffer);
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
