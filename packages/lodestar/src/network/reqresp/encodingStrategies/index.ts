import {ReqRespEncoding} from "../../../constants";
import {BufferedSource} from "../utils/bufferedSource";
import {RequestOrResponseBody, RequestOrResponseType} from "../interface";
import {readSszSnappyPayload, ISszSnappyOptions} from "./sszSnappy/decode";
import {writeSszSnappyPayload} from "./sszSnappy/encode";

// For more info about eth2 request/response encoding strategies, see:
// https://github.com/ethereum/eth2.0-specs/blob/dev/specs/phase0/p2p-interface.md#encoding-strategies
// Supported encoding strategies:
// - ssz_snappy

/**
 * Consumes a stream source to read encoding-dependent-header and encoded-payload as defined in the spec
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function readEncodedPayload<T extends RequestOrResponseBody>(
  bufferedSource: BufferedSource,
  encoding: ReqRespEncoding,
  type: RequestOrResponseType,
  options?: ISszSnappyOptions
): Promise<T> {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY:
      return await readSszSnappyPayload(bufferedSource, type, options);

    default:
      throw Error("Unsupported encoding");
  }
}

/**
 * Yields byte chunks for encoding-dependent-header and encoded-payload as defined in the spec
 * ```
 * <encoding-dependent-header> | <encoded-payload>
 * ```
 */
export async function* writeEncodedPayload<T extends RequestOrResponseBody>(
  body: T,
  encoding: ReqRespEncoding,
  type: RequestOrResponseType
): AsyncGenerator<Buffer> {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY:
      yield* writeSszSnappyPayload(body, type);
      break;

    default:
      throw Error("Unsupported encoding");
  }
}
