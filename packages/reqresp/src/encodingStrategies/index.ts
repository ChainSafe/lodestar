import {Encoding, TypeSizes} from "../types.js";
import {BufferedSource} from "../utils/index.js";
import {readSszSnappyPayload} from "./sszSnappy/decode.js";
import {writeSszSnappyPayload} from "./sszSnappy/encode.js";

// For more info about Ethereum Consensus request/response encoding strategies, see:
// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#encoding-strategies
// Supported encoding strategies:
// - ssz_snappy

/**
 * Consumes a stream source to read encoded header and payload as defined in the spec:
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function readEncodedPayload(
  bufferedSource: BufferedSource,
  encoding: Encoding,
  type: TypeSizes
): Promise<Uint8Array> {
  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      return readSszSnappyPayload(bufferedSource, type);

    default:
      throw Error("Unsupported encoding");
  }
}

/**
 * Yields byte chunks for encoded header and payload as defined in the spec:
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function* writeEncodedPayload(chunkData: Uint8Array, encoding: Encoding): AsyncGenerator<Buffer> {
  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      yield* writeSszSnappyPayload(chunkData);
      break;

    default:
      throw Error("Unsupported encoding");
  }
}
