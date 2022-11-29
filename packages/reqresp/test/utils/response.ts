import {pipe} from "it-pipe";
import {allForks} from "@lodestar/types";
import {responseEncodeError, responseEncodeSuccess} from "../../src/encoders/responseEncode.js";
import {RespStatus} from "../../src/interface.js";
import {EncodedPayload, EncodedPayloadType, ProtocolDefinition} from "../../src/types.js";
import {ResponseChunk} from "../fixtures/encoders.js";
import {beaconConfig} from "../fixtures/messages.js";
import {blocksToReqRespBlockResponses} from "../utils/block.js";
import {arrToSource} from "../utils/index.js";

export async function* responseEncode(
  responseChunks: ResponseChunk[],
  protocol: ProtocolDefinition<any, any>
): AsyncIterable<Buffer> {
  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      if (chunk.payload.type === EncodedPayloadType.bytes) {
        return [chunk.payload.bytes];
      }

      const lodestarResponseBodies = protocol.method.startsWith("beacon_blocks")
        ? blocksToReqRespBlockResponses(([chunk.payload.data] as unknown) as allForks.SignedBeaconBlock[], beaconConfig)
        : [chunk.payload];

      yield* pipe(
        arrToSource(lodestarResponseBodies as EncodedPayload<allForks.SignedBeaconBlock>[]),
        responseEncodeSuccess(protocol)
      );
    } else {
      yield* responseEncodeError(protocol, chunk.status, chunk.errorMessage);
    }
  }
}
