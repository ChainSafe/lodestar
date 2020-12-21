import {RequestBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding} from "../../../constants";
import {writeChunk} from "../encodingStrategies";

export function requestEncode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<RequestBody | null>) => AsyncGenerator<Buffer> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);

    for await (const requestBody of source) {
      if (type && requestBody !== null) {
        yield* writeChunk(requestBody, encoding, type);
      }
    }
  };
}

export async function* requestEncodeOne(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding,
  requestBody: RequestBody
): AsyncGenerator<Buffer> {
  const type = Methods[method].requestSSZType(config);

  if (type && requestBody !== null) {
    yield* writeChunk(requestBody, encoding, type);
  }
}
