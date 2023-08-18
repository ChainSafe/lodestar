import {encode as varintEncode} from "uint8-varint";
import {encodeSnappy} from "./snappyFrames/compress.js";

/**
 * ssz_snappy encoding strategy writer.
 * Yields byte chunks for encoded header and payload as defined in the spec:
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export const writeSszSnappyPayload = encodeSszSnappy as (bytes: Uint8Array) => AsyncGenerator<Buffer>;

/**
 * Buffered Snappy writer
 */
export async function* encodeSszSnappy(bytes: Buffer): AsyncGenerator<Buffer> {
  // MUST encode the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
  yield Buffer.from(varintEncode(bytes.length));

  // By first computing and writing the SSZ byte length, the SSZ encoder can then directly
  // write the chunk contents to the stream. Snappy writer compresses frame by frame
  yield* encodeSnappy(bytes);
}
