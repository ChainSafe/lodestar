import type {MessageStream} from "@libp2p/interface";
import type {ByteStream} from "@libp2p/utils";
import {Uint8ArrayList} from "uint8arraylist";
import {Encoding, TypeSizes} from "../types.js";
import {decodeSszSnappyPayload} from "./sszSnappy/decode.js";
import {encodeSszSnappyPayload} from "./sszSnappy/encode.js";

// For more info about Ethereum Consensus request/response encoding strategies, see:
// https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#encoding-strategies
// Supported encoding strategies:
// - ssz_snappy

/**
 * Encodes a payload (SSZ data) with the specified encoding strategy.
 * Returns bytes ready for writing to stream:
 * ```
 * <varint-length> | <snappy-frames(ssz-payload)>
 * ```
 */
export function encodePayload(data: Uint8Array, encoding: Encoding): Uint8ArrayList {
  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      return encodeSszSnappyPayload(data);

    default:
      throw Error("Unsupported encoding");
  }
}

/**
 * Reads and decodes a payload from stream using byteStream.
 * Expects wire format:
 * ```
 * <varint-length> | <snappy-frames(ssz-payload)>
 * ```
 */
export async function decodePayload(
  bytes: ByteStream<MessageStream>,
  encoding: Encoding,
  type: TypeSizes,
  signal?: AbortSignal
): Promise<Uint8Array> {
  switch (encoding) {
    case Encoding.SSZ_SNAPPY:
      return decodeSszSnappyPayload(bytes, type, signal);

    default:
      throw Error("Unsupported encoding");
  }
}
