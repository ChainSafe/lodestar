import {responseEncodeError, responseEncodeSuccess} from "../../src/encoders/responseEncode.js";
import {RespStatus} from "../../src/interface.js";
import {Protocol} from "../../src/types.js";
import {ResponseChunk} from "../fixtures/encoders.js";
import {beaconConfig} from "../fixtures/messages.js";
import {arrToSource} from "../utils/index.js";

export async function* responseEncode(responseChunks: ResponseChunk[], protocol: Protocol): AsyncIterable<Uint8Array> {
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      const payload = chunk.payload;
      yield* responseEncodeSuccess(
        protocol,
        arrToSource([
          {...payload, boundary: beaconConfig.getForkBoundaryAtEpoch(beaconConfig.forks[payload.fork].epoch)},
        ])
      );
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}
