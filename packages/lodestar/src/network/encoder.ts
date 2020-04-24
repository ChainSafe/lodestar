import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {MAX_CHUNK_SIZE, Method, ReqRespEncoding, RpcResponseStatus} from "../constants";
import {RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {IReqRespEncoder, SnappyEncoder, SszEncoder} from "./encoders";
import {getRequestMethodSSZType, getResponseMethodSSZType} from "./util";
import * as varint from "varint";
import {ResponseChunk} from "./interface";
// eslint-disable-next-line import/no-extraneous-dependencies
import BufferList from "bl";
import {RpcError} from "./error";

export class ReqRespEncoder {

  public readonly encoding: ReqRespEncoding;

  private readonly config: IBeaconConfig;

  constructor(config: IBeaconConfig, encoding: ReqRespEncoding) {
    this.config = config;
    this.encoding = encoding;
  }

  public encodeRequest(method: Method, data: RequestBody): Buffer {
    const type = getRequestMethodSSZType(this.config, method);
    const encoders = this.getEncoders(this.encoding);
    const encodedPayload =  encoders.reduce((result: unknown, encoder) => {
      return encoder.encode(type, result);
    }, data) as Buffer;
    return this.writeLengthPrefixed(encodedPayload);
  }

  public decodeRequest(method: Method, data: Buffer): RequestBody {
    if (!data) {
      return undefined;
    }
    data = this.readLengthPrefixed(data);
    const type = getRequestMethodSSZType(this.config, method);
    //decoding is done backwards
    const encoders = this.getEncoders(this.encoding).reverse();
    return encoders.reduce((result: unknown, encoder) => {
      return encoder.decode(type, result);
    }, data) as RequestBody;
  }

  public encodeResponse(
    method: Method
  ): ((source: AsyncIterable<ResponseChunk>) => AsyncGenerator<Buffer>) {
    const encoders = this.getEncoders(this.encoding);
    const type = getResponseMethodSSZType(this.config, method);
    const writeLP = this.writeLengthPrefixed;
    const writeStatus = this.writeStatus;
    return (source: AsyncIterable<ResponseChunk>) => {
      return (async function * () {
        for await (const chunk of source) {
          let encodedPayload: Buffer = Buffer.alloc(0);
          if(chunk && (chunk.output !== null && chunk.output !== undefined)){
            encodedPayload = encoders.reduce((result: unknown, encoder) => {
              return encoder.encode(type, result);
            }, chunk.output) as Buffer;
          }
          const status = chunk.err && chunk.err.status;
          yield writeStatus(writeLP(encodedPayload), status);
          if(status) {
            // error => stop yielding response_chunk
            break;
          }
        }
      })();
    };
  }

  public decodeResponse(method: Method): ((source: AsyncIterable<Buffer|BufferList>) => AsyncGenerator<ResponseBody>) {
    //decoding is done backwards
    const encoders = this.getEncoders(this.encoding).reverse();
    const readLP = this.readLengthPrefixed;
    const readStatus= this.readStatus;
    const type = getResponseMethodSSZType(this.config, method);
    return (source: AsyncIterable<Buffer|BufferList>) => {
      return (async function * () {
        for await (const val of source) {
          const payload = readLP(readStatus(val.slice()));
          yield encoders.reduce((result: unknown, encoder) => {
            return encoder.decode(type, result);
          }, payload) as ResponseBody;
        }
      })();
    };
  }

  private getEncoders(encoding: ReqRespEncoding): IReqRespEncoder<unknown>[] {
    switch (encoding) {
      case ReqRespEncoding.SSZ:
        return [new SszEncoder()];
      case ReqRespEncoding.SSZ_SNAPPY:
        return  [new SszEncoder(), new SnappyEncoder()];
    }
    return [];
  }

  private writeLengthPrefixed(encodedPayload: Buffer): Buffer {
    return Buffer.concat([
      Buffer.from(varint.encode(encodedPayload.length)),
      encodedPayload
    ]);
  }

  private readLengthPrefixed(encodedPayload: Buffer): Buffer {
    const length = varint.decode(encodedPayload);
    const lengthBytes = varint.decode.bytes;
    if (
      length !== encodedPayload.length - lengthBytes ||
          length > MAX_CHUNK_SIZE
    ) {
      throw new RpcError(RpcResponseStatus.ERR_INVALID_REQ);
    }
    return encodedPayload.slice(lengthBytes);
  }

  private readStatus(payload: Buffer): Buffer {
    const code = payload[0];
    if (code !== 0) {
      throw new Error("Req/Resp response contains chunk with error code " + code);
    }
    return payload.slice(1);
  }

  private writeStatus(payload: Buffer, status = 0): Buffer {
    return Buffer.concat([
      Buffer.from([status]),
      payload
    ]);
  }
}