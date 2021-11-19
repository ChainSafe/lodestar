import {
  Encoding,
  RequestOrResponseType,
  RequestOrIncomingResponseBody,
  RequestOrOutgoingResponseBody,
  OutgoingSerializer,
} from "../types";
import {BufferedSource} from "../utils";
import {readSszSnappyPayload, ISszSnappyOptions} from "./sszSnappy/decode";
import {writeSszSnappyPayload} from "./sszSnappy/encode";

// For more info about eth2 request/response encoding strategies, see:
// https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#encoding-strategies
// Supported encoding strategies:
// - ssz_snappy

/**
 * Consumes a stream source to read encoded header and payload as defined in the spec:
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function readEncodedPayload<T extends RequestOrIncomingResponseBody>(
  bufferedSource: BufferedSource,
  encoding: Encoding,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): Promise<T> {
  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      return await readSszSnappyPayload(bufferedSource, type, options);

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
export async function* writeEncodedPayload<T extends RequestOrOutgoingResponseBody>(
  body: T,
  encoding: Encoding,
  serializer: OutgoingSerializer
): AsyncGenerator<Buffer> {
  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      yield* writeSszSnappyPayload(body, serializer);
      break;

    default:
      throw Error("Unsupported encoding");
  }
}
