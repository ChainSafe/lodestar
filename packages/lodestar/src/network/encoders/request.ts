import pipe from "it-pipe";
import BufferList from "bl";
import {decode, encode} from "varint";
import {ILogger} from "@chainsafe/lodestar-utils";
import {RequestBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding} from "../../constants";
import {toBuffer} from "../../util/buffer";
import {getCompressor, getDecompressor, maxEncodedLen} from "./utils";
import {IValidatedRequestBody} from "./interface";

export async function streamRequestBodyTo(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding,
  requestBody: RequestBody,
  requestBodySink: Stream
): Promise<void> {
  if (requestBody == null) return;

  const serialized = serializeRequestBody(config, method, requestBody);
  if (serialized == null) return;

  const bodyEncodedStream = getRequestBodyEncodedStream(encoding, serialized);
  await pipe(bodyEncodedStream, requestBodySink);
}

/**
 * Serializes `requestBody` to bytes serialization of `method` SSZ type
 * SSZ type for `method` may not exist, then returns null
 */
export function serializeRequestBody(
  config: IBeaconConfig,
  method: Method,
  requestBody: RequestBody
): Uint8Array | null {
  const type = Methods[method].requestSSZType(config);
  if (type == null || requestBody == null) {
    return null;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return type.serialize(requestBody as any);
  }
}

/**
 * Returns a stream of `encoding` compressed bytes of `requestBodySerialized`
 */
export async function* getRequestBodyEncodedStream(
  encoding: ReqRespEncoding,
  requestBodySerialized: Uint8Array
): AsyncGenerator<Buffer> {
  const compressor = getCompressor(encoding);

  yield Buffer.from(encode(requestBodySerialized.length));
  yield* compressor(toBuffer(requestBodySerialized));
}

export function eth2RequestDecode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer | BufferList>) => AsyncGenerator<IValidatedRequestBody> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);
    if (!type) {
      //method has no body, emit null to trigger response
      yield {isValid: true, body: null!};
      return;
    }

    let sszDataLength: number | null = null;
    const decompressor = getDecompressor(encoding);
    const buffer = new BufferList();

    for await (let chunk of source) {
      if (!chunk || chunk.length === 0) {
        continue;
      }

      if (sszDataLength === null) {
        sszDataLength = decode(chunk.slice());
        if (decode.bytes > 10) {
          logger.error("eth2RequestDecode: Invalid number of bytes for protobuf varint", {
            bytes: decode.bytes,
            method,
          });
          yield {isValid: false};
          break;
        }

        chunk = chunk.slice(decode.bytes);
        if (chunk.length === 0) {
          continue;
        }
      }

      if (sszDataLength < type.minSize() || sszDataLength > type.maxSize()) {
        logger.error("eth2RequestDecode: Invalid szzLength", {sszDataLength, method});
        yield {isValid: false};
        break;
      }

      if (chunk.length > maxEncodedLen(sszDataLength, encoding)) {
        logger.error("eth2RequestDecode: too much bytes read", {chunkLength: chunk.length, sszDataLength, method});
        yield {isValid: false};
        break;
      }

      let uncompressed: Buffer | null = null;
      try {
        uncompressed = decompressor.uncompress(chunk.slice());
      } catch (e) {
        logger.error("Failed to decompress request data", {error: e.message});
        yield {isValid: false};
        break;
      }

      if (uncompressed) {
        buffer.append(uncompressed);
      }

      if (buffer.length < sszDataLength) {
        continue;
      }

      if (buffer.length > sszDataLength) {
        logger.error("Too long message received", {method});
        yield {isValid: false};
        break;
      }

      try {
        yield {isValid: true, body: type.deserialize(buffer.slice(0, sszDataLength)) as RequestBody};
      } catch (e) {
        logger.error("Malformed input. Failed to deserialize request type", {method, error: e.message});
        yield {isValid: false};
        break;
      }
      //only one request body accepted
      break;
    }
  };
}
