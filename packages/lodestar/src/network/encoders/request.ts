import {Method, Methods, ReqRespEncoding} from "../../constants";
import {ILogger} from "@chainsafe/lodestar-utils";
import {RequestBody} from "@chainsafe/lodestar-types";
import varint from "varint";
import BufferList from "bl";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {getCompressor} from "./utils";
import {IValidatedRequestBody} from "./interface";
import {BufferedSource} from "./bufferedSource";
import {readChunk} from "./encoding";

export function eth2RequestEncode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<RequestBody | null>) => AsyncGenerator<Buffer> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);
    let compressor = getCompressor(encoding);

    for await (const request of source) {
      if (!type || request === null) continue;

      let serialized: Uint8Array;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        serialized = type.serialize(request as any);
      } catch (e) {
        logger.warn("Malformed input. Failed to serialize request", {method}, e);
        continue;
      }

      yield Buffer.from(varint.encode(serialized.length));

      yield* compressor(Buffer.from(serialized.buffer, serialized.byteOffset, serialized.length));

      // reset compressor
      compressor = getCompressor(encoding);
    }
  };
}

// The responder MUST:
// 1. Use the encoding strategy to read the optional header.
// 2. If there are any length assertions for length N, it should read
//    exactly N bytes from the stream, at which point an EOF should arise
//    (no more bytes). Error otherwise
// 3. Deserialize the expected type, and process the request. Error otherwise
// 4. Write the response which may consist of zero or more response_chunks
//    (result, optional header, payload).
// 5. Close their write side of the stream. At this point, the stream
//    will be fully closed.

export function eth2RequestDecode(
  config: IBeaconConfig,
  logger: ILogger,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<Buffer | BufferList>) => AsyncGenerator<IValidatedRequestBody> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);
    if (!type) {
      // method has no body, emit null to trigger response
      yield {isValid: true, body: null!};
      return;
    }

    try {
      const bufferedSource = new BufferedSource(source as AsyncGenerator<Buffer>);
      const requestBody: RequestBody = await readChunk(bufferedSource, encoding, type);
      yield {isValid: true, body: requestBody};
    } catch (e) {
      // # TODO: Append method and requestId to error here
      logger.error("eth2RequestDecode", {method}, e);
      yield {isValid: false};
    }
  };
}
