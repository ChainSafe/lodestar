import {RequestBody} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Method, Methods, ReqRespEncoding} from "../../../constants";
import {writeChunk} from "../encodingStrategies";

export function eth2RequestEncode(
  config: IBeaconConfig,
  method: Method,
  encoding: ReqRespEncoding
): (source: AsyncIterable<RequestBody | null>) => AsyncGenerator<Buffer> {
  return async function* (source) {
    const type = Methods[method].requestSSZType(config);

    for await (const request of source) {
      if (!type || request === null) continue;
      yield* writeChunk(request, encoding, type);
    }
  };
}
