import {config} from "@lodestar/config/default";
import {isForkPostFulu} from "@lodestar/params";
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
            boundary: isForkPostFulu(fork)
              ? {fork, EPOCH: config.ELECTRA_FORK_EPOCH, MAX_BLOBS_PER_BLOCK: config.MAX_BLOBS_PER_BLOCK_ELECTRA}
              : {fork},
          },
        ]),
        responseEncodeSuccess(protocol, {onChunk: () => {}})
      );
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}
