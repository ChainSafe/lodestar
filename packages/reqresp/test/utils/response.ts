import {pipe} from "it-pipe";
import {responseEncodeError, responseEncodeSuccess} from "../../src/encoders/responseEncode.js";
import {RespStatus} from "../../src/interface.js";
import {ProtocolDefinition} from "../../src/types.js";
import {ResponseChunk, SuccessResponseChunk} from "../fixtures/encoders.js";
import {arrToSource} from "../utils/index.js";

export async function* responseEncode(
  responseChunks: ResponseChunk[],
  protocol: ProtocolDefinition<any, any>
): AsyncIterable<Buffer> {
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      yield* pipe(arrToSource([(chunk as SuccessResponseChunk).payload]), responseEncodeSuccess(protocol));
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}
