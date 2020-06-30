import {IResponseChunk} from "./interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Method, MethodResponseType, Methods, ReqRespEncoding, RequestId, RpcResponseStatus} from "../../constants";
import {decode, encode} from "varint";
import {encodeResponseStatus, getCompressor, getDecompressor, maxEncodedLen} from "./utils";
import BufferList from "bl";
import {ResponseBody, P2pErrorMessage} from "@chainsafe/lodestar-types";

export function eth2ResponseEncode(
  config: IBeaconConfig, logger: ILogger, method: Method, encoding: ReqRespEncoding
): (source: AsyncIterable<IResponseChunk>) => AsyncIterable<Buffer> {
  return (source => {
    return (async function*() {
      const type = Methods[method].responseSSZType(config);
      let compressor = getCompressor(encoding);
      if(!type) {
        return;
      }
      for await (const chunk of source) {
        if(chunk.status !== RpcResponseStatus.SUCCESS) {
          yield encodeResponseStatus(chunk.status);
          if (chunk.body) {
            yield Buffer.from(config.types.P2pErrorMessage.serialize(chunk.body as P2pErrorMessage));
          }
          break;
        }
        //yield status
        yield encodeResponseStatus(chunk.status);
        let serializedData: Buffer;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const serialized = type.serialize(chunk.body as any);
          serializedData = Buffer.from(serialized.buffer, serialized.byteOffset, serialized.length);
        } catch (e) {
          logger.warn(`Failed to ssz serialize chunk of method ${method}. Error: ${e.message}`);
        }
        //yield encoded ssz length
        yield Buffer.from(encode(serializedData.length));
        //yield compressed or uncompressed data chunks
        yield* compressor(serializedData);
        //reset compressor
        compressor = getCompressor(encoding);
      }
    })();
  });
}

export function eth2ResponseDecode(
  config: IBeaconConfig, logger: ILogger, method: Method, encoding: ReqRespEncoding, requestId: RequestId
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return (source) => {
    return (async function*() {
      //floating buffer with current chunk
      let buffer = new BufferList();
      //holds uncompressed chunks
      let uncompressedData = new BufferList();
      let status: number = null;
      let errorMessage: string = null;
      let sszLength: number = null;
      const decompressor = getDecompressor(encoding);
      const type = Methods[method].responseSSZType(config);
      for await (const chunk of source) {
        buffer.append(chunk);
        if(status === null) {
          status = buffer.get(0);
          buffer.consume(1);
        }
        if(buffer.length === 0) continue;
        if(status && status !== RpcResponseStatus.SUCCESS) {
          try {
            const err = config.types.P2pErrorMessage.deserialize(buffer.slice());
            errorMessage = decodeP2pErrorMessage(config, err);
            buffer = new BufferList();
          } catch (e) {
            logger.warn(`Failed to get error message from other node, method ${method}, error ${e.message}`);
          }
          logger.warn(`eth2ResponseDecode: Received err status '${status}' with message ` +
          `'${errorMessage}' for method ${method} and request ${requestId}`);
          break;
        }
        if(sszLength === null) {
          sszLength = decode(buffer.slice());
          if (decode.bytes > 10) {
            throw new Error(`eth2ResponseDecode: Invalid number of bytes for protobuf varint ${decode.bytes}` +
            `, method ${method}`);
          }
          buffer.consume(decode.bytes);
        }
        if (sszLength < type.minSize() || sszLength > type.maxSize()) {
          throw new Error(`eth2ResponseDecode: Invalid szzLength of ${sszLength} for method ${method}`);
        }
        if (buffer.length > maxEncodedLen(sszLength, encoding)) {
          throw new Error(`eth2ResponseDecode: too much bytes read (${buffer.length}) for method ${method}, ` +
            `sszLength ${sszLength}`);
        }
        if(buffer.length === 0) continue;
        let uncompressed: Buffer;
        try {
          uncompressed = decompressor.uncompress(buffer.slice());
          buffer.consume(buffer.length);
        } catch (e) {
          logger.warn(`Failed to uncompress data for method ${method}. Error: ${e.message}`, {requestId, encoding});
        }
        if(uncompressed) {
          uncompressedData.append(uncompressed);
          if(uncompressedData.length > sszLength) {
            throw new Error(`Received too much data for method ${method}`);
          }
          if(uncompressedData.length === sszLength) {
            try {
              yield type.deserialize(uncompressedData.slice()) as ResponseBody;
              buffer = new BufferList();
              uncompressedData = new BufferList();
              decompressor.reset();
              status = null;
              sszLength = null;
              if(Methods[method].responseType === MethodResponseType.SingleResponse) {
                break;
              }
            } catch (e) {
              logger.warn(
                `Failed to ssz deserialize data for method ${method}. Error: ${e.message}`,
                {requestId, encoding}
              );
            }
          }
        }
      }
      if (buffer.length > 0) {
        throw new Error(`There is remaining data not deserialized for method ${method}`);
      }
    })();
  };
}

export function encodeP2pErrorMessage(config: IBeaconConfig, err: string): P2pErrorMessage {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(err.substring(0, 256));
  return config.types.P2pErrorMessage.deserialize(bytes);
}

export function decodeP2pErrorMessage(config: IBeaconConfig, err: P2pErrorMessage): string {
  const bytes = config.types.P2pErrorMessage.serialize(err);
  const encoder = new TextDecoder();
  return encoder.decode(bytes);
}
