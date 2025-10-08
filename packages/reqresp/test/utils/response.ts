import {pipe} from "it-pipe";
import {responseEncodeError, responseEncodeSuccess} from "../../src/encoders/responseEncode.js";
import {RespStatus} from "../../src/interface.js";
import {Protocol} from "../../src/types.js";
import {ResponseChunk} from "../fixtures/encoders.js";
import {beaconConfig} from "../fixtures/messages.js";
import {arrToSource} from "../utils/index.js";

export async function* responseEncode(responseChunks: ResponseChunk[], protocol: Protocol): AsyncIterable<Buffer> {
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      const payload = chunk.payload;
      yield* pipe(
        arrToSource([
          {...payload, boundary: beaconConfig.getForkBoundaryAtEpoch(beaconConfig.forks[payload.fork].epoch)},
        ]),
        responseEncodeSuccess(protocol, {onChunk: () => {}})
      );
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}
