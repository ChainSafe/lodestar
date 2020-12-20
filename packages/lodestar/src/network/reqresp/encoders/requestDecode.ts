import BufferList from "bl";
import {ILogger} from "@chainsafe/lodestar-utils";
import {RequestBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding} from "../../../constants";
import {IValidatedRequestBody} from "../interface";
import {BufferedSource} from "../utils/bufferedSource";
import {readChunk} from "../encodingStrategies";

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
