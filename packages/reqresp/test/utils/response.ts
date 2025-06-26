import {createSubscribeBoundary} from "@lodestar/config";
import {config} from "@lodestar/config/default.js";
import {pipe} from "it-pipe";
import {responseEncodeError, responseEncodeSuccess} from "../../src/encoders/responseEncode.js";
import {RespStatus} from "../../src/interface.js";
import {Protocol} from "../../src/types.js";
import {ResponseChunk} from "../fixtures/encoders.js";
import {arrToSource} from "../utils/index.js";

export async function* responseEncode(responseChunks: ResponseChunk[], protocol: Protocol): AsyncIterable<Buffer> {
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      const payload = chunk.payload;
      const fork = payload.fork;
      yield* pipe(
        arrToSource([
          {
            ...payload,
            boundary: createSubscribeBoundary(config, config.forks[fork].epoch),
          },
        ]),
        responseEncodeSuccess(protocol, {onChunk: () => {}})
      );
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}
