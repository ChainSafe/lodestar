import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {P2pErrorMessage, ResponseBody} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {CompositeType} from "@chainsafe/ssz";
import {AbortController} from "abort-controller";
import BufferList from "bl";
import {decode, encode} from "varint";
import {Method, MethodResponseType, Methods, ReqRespEncoding, RequestId, RpcResponseStatus} from "../../constants";
import {IResponseChunk} from "./interface";
import {encodeResponseStatus, getCompressor, getDecompressor, maxEncodedLen} from "./utils";

export function eth2ResponseEncode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<IResponseChunk>) => AsyncIterable<Buffer> {
  return async function* (source) {
    const type = Methods[method].responseSSZType(config);
    let compressor = getCompressor(encoding);
    if (!type) {
      return;
    }
    for await (const chunk of source) {
      if (chunk.status !== RpcResponseStatus.SUCCESS) {
        yield encodeResponseStatus(chunk.status);
        if (chunk.body) {
          yield Buffer.from(config.types.P2pErrorMessage.serialize(chunk.body as P2pErrorMessage));
        }
        break;
      }

      // yield status
      yield encodeResponseStatus(chunk.status);
      let serializedData: Buffer;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const serialized = type.serialize(chunk.body as any);
        serializedData = Buffer.from(serialized.buffer, serialized.byteOffset, serialized.length);
      } catch (e) {
        logger.warn("Failed to ssz serialize chunk", {method}, e);
      }

      // yield encoded ssz length
      yield Buffer.from(encode(serializedData!.length));

      // yield compressed or uncompressed data chunks
      yield* compressor(serializedData!);

      // reset compressor
      compressor = getCompressor(encoding);
    }
  };
}

export function eth2ResponseDecode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding,
  requestId: RequestId,
  controller: AbortController
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return async function* (source) {
    // floating buffer with current chunk
    let buffer = new BufferList();

    // holds uncompressed chunks
    let uncompressedData = new BufferList();
    let status: number | null = null;
    let errorMessage: string | null = null;
    let sszLength: number | null = null;

    const decompressor = getDecompressor(encoding);
    const type = Methods[method].responseSSZType(config);

    for await (const chunk of source) {
      buffer.append(chunk);
      if (status === null) {
        status = buffer.get(0);
        buffer.consume(1);
      }

      if (buffer.length === 0) continue;
      if (status && status !== RpcResponseStatus.SUCCESS) {
        try {
          errorMessage = decodeP2pErrorMessage(config, buffer.slice());
          buffer = new BufferList();
        } catch (e) {
          logger.warn("Failed to get error message from response", {method, requestId}, e);
        }
        logger.warn("eth2ResponseDecode: Received err status", {status, errorMessage, method, requestId});
        controller.abort();
        continue;
      }

      if (sszLength === null) {
        sszLength = decode(buffer.slice());
        if (decode.bytes > 10) {
          throw new Error(
            `eth2ResponseDecode: Invalid number of bytes for protobuf varint ${decode.bytes}` + `, method ${method}`
          );
        }
        buffer.consume(decode.bytes);
      }

      if (sszLength < type.minSize() || sszLength > type.maxSize()) {
        throw new Error(`eth2ResponseDecode: Invalid szzLength of ${sszLength} for method ${method}`);
      }

      if (buffer.length > maxEncodedLen(sszLength, encoding)) {
        throw new Error(
          `eth2ResponseDecode: too much bytes read (${buffer.length}) for method ${method}, ` + `sszLength ${sszLength}`
        );
      }

      if (buffer.length === 0) continue;
      let uncompressed: Buffer | null = null;
      try {
        uncompressed = decompressor.uncompress(buffer.slice());
        buffer.consume(buffer.length);
      } catch (e) {
        logger.warn("Failed to uncompress data", {method, requestId, encoding}, e);
      }

      if (uncompressed) {
        uncompressedData.append(uncompressed);
        if (uncompressedData.length > sszLength) {
          throw new Error(`Received too much data for method ${method}`);
        }

        if (uncompressedData.length === sszLength) {
          try {
            if (method === Method.BeaconBlocksByRange || method === Method.BeaconBlocksByRoot) {
              yield (((type as unknown) as CompositeType<Record<string, unknown>>).tree.deserialize(
                uncompressedData.slice()
              ) as unknown) as ResponseBody;
            } else {
              yield type.deserialize(uncompressedData.slice()) as ResponseBody;
            }
            buffer = new BufferList();
            uncompressedData = new BufferList();
            decompressor.reset();
            status = null;
            sszLength = null;
            if (Methods[method].responseType === MethodResponseType.SingleResponse) {
              controller.abort();
              continue;
            }
          } catch (e) {
            logger.warn("Failed to ssz deserialize data", {method, requestId, encoding}, e);
          }
        }
      }
    }
    if (buffer.length > 0) {
      throw new Error(`There is remaining data not deserialized for method ${method}`);
    }
  };
}

/**
 * Encodes error message per eth2 spec.
 * https://github.com/ethereum/eth2.0-specs/blob/v1.0.0-rc.0/specs/phase0/p2p-interface.md#responding-side
 */
export function encodeP2pErrorMessage(config: IBeaconConfig, err: string): P2pErrorMessage {
  const encoder = new TextEncoder();
  return config.types.P2pErrorMessage.deserialize(encoder.encode(err).slice(0, 256));
}

/**
 * Decodes error message from network bytes and removes non printable, non ascii characters.
 */
export function decodeP2pErrorMessage(config: IBeaconConfig, err: Uint8Array): string {
  const encoder = new TextDecoder();
  // remove non ascii characters from string
  return encoder.decode(err).replace(/[^\x20-\x7F]/g, "");
}
