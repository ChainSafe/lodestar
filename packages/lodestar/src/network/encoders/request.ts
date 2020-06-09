import {Method, Methods, ReqRespEncoding, RpcResponseStatus, ValidatedRequestBody} from "../../constants";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {RequestBody} from "@chainsafe/lodestar-types";
import {decode, encode} from "varint";
import BufferList from "bl";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getCompressor, getDecompressor, maxEncodedLen} from "./utils";

export function eth2RequestEncode(
  config: IBeaconConfig, logger: ILogger, method: Method, encoding: ReqRespEncoding
): (source: AsyncIterable<RequestBody>) => AsyncGenerator<Buffer> {
  return (source => {
    return (async function*() {
      const type = Methods[method].requestSSZType(config);
      let compressor = getCompressor(encoding);
      for await (const request of source) {
        if(!type || !request) continue;
        let serialized: Uint8Array;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          serialized = type.serialize(request as any);
        } catch (e) {
          logger.warn("Malformed input. Failed to serialize request for method " + method);
          continue;
        }
        yield Buffer.from(encode(serialized.length));
        yield* compressor(Buffer.from(serialized.buffer, serialized.byteOffset, serialized.length));
        //reset compressor
        compressor = getCompressor(encoding);
      }
    })();
  });
}

export function eth2RequestDecode(
  config: IBeaconConfig, logger: ILogger, method: Method, encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer|BufferList>) => AsyncGenerator<ValidatedRequestBody> {
  return (source) => {
    return (async function*() {
      let sszDataLength: number = null;
      const decompressor = getDecompressor(encoding);
      const buffer = new BufferList();
      const type = Methods[method].requestSSZType(config);
      for await (let chunk of source) {
        if(!chunk || chunk.length === 0) {
          continue;
        }
        if(sszDataLength === null) {
          sszDataLength = decode(chunk.slice());
          if (decode.bytes > 10) {
            logger.error(`eth2RequestDecode: Invalid number of bytes for protobuf varint ${decode.bytes}` +
            `, method ${method}`);
            yield RpcResponseStatus.ERR_INVALID_REQ;
            break;
          }
          chunk = chunk.slice(decode.bytes);
          if(chunk.length === 0) {
            continue;
          }
        }
        if (sszDataLength < type.minSize() || sszDataLength > type.maxSize()) {
          logger.error(`eth2RequestDecode: Invalid szzLength of ${sszDataLength} for method ${method}`);
          yield RpcResponseStatus.ERR_INVALID_REQ;
          break;
        }
        if (chunk.length > maxEncodedLen(sszDataLength, encoding)) {
          logger.error(`eth2RequestDecode: too much bytes read (${chunk.length}) for method ${method}, ` +
            `sszLength ${sszDataLength}`);
          yield RpcResponseStatus.ERR_INVALID_REQ;
          break;
        }
        let uncompressed: Buffer;
        try {
          uncompressed = decompressor.uncompress(chunk.slice());
        } catch (e) {
          logger.error("Failed to decompress request data. Error: " + e.message);
          yield RpcResponseStatus.ERR_INVALID_REQ;
          break;
        }
        if(uncompressed) {
          buffer.append(uncompressed);
        }
        if(buffer.length < sszDataLength) {
          continue;
        }
        if(buffer.length > sszDataLength) {
          logger.error("Too long message received for method " + method);
          yield RpcResponseStatus.ERR_INVALID_REQ;
          break;
        }
        try {
          yield type.deserialize(buffer.slice(0, sszDataLength)) as RequestBody;
        } catch (e) {
          logger.error(`Malformed input. Failed to deserialize ${method} request type. Error: ${e.message}`);
          yield RpcResponseStatus.ERR_INVALID_REQ;
          break;
        }
        //only one request body accepted
        break;
      }
    })();
  };
}