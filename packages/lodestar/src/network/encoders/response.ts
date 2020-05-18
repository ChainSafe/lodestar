import {IResponseChunk} from "./interface";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {Method, MethodResponseType, Methods, ReqRespEncoding, RpcResponseStatus} from "../../constants";
import {decode, encode} from "varint";
import {encodeResponseStatus, getCompressor, getDecompressor} from "./utils";
import BufferList from "bl";
import {ResponseBody} from "@chainsafe/lodestar-types";

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
        if(chunk.status !== 0) {
          yield encodeResponseStatus(chunk.status);
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
  config: IBeaconConfig, logger: ILogger, method: Method, encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer>) => AsyncGenerator<ResponseBody> {
  return (source) => {
    return (async function*() {
      //floating buffer with current chunk
      let buffer = new BufferList();
      //holds uncompressed chunks
      let uncompressedData = new BufferList();
      let status: number = null;
      let sszLength: number = null;
      const decompressor = getDecompressor(encoding);
      const type = Methods[method].responseSSZType(config);
      for await (const chunk of source) {
        buffer.append(chunk);
        if(status === null) {
          status = buffer.get(0);
          buffer.consume(1);
          if(status !== RpcResponseStatus.SUCCESS) {
            logger.warn(`Received err status ${status} for method ${method}`);
            break;
          }
        }
        if(buffer.length === 0) continue;
        if(sszLength === null) {
          sszLength = decode(buffer.slice());
          buffer.consume(decode.bytes);
        }
        if(buffer.length === 0) continue;
        let uncompressed: Buffer;
        try {
          uncompressed = decompressor.uncompress(buffer.slice());
          buffer.consume(buffer.length);
        } catch (e) {
          logger.warn(`Failed to uncompress data for method ${method}. Error: ${e.message}`);
        }
        if(uncompressed) {
          uncompressedData.append(uncompressed);
          if(uncompressedData.length > sszLength) {
            logger.warn(`Received too much data for method ${method}`);
            break;
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
              logger.warn(`Failed to ssz deserialize data for method ${method}. Error: ${e.message}`);
            }
          }
        }
      }
    })();
  };
}
