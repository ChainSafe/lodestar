import {altair, allForks} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  PayloadType,
  LightClientServerError,
  LightClientServerErrorCode,
  ResponseError,
  RespStatus,
  ProtocolDescriptor,
  IncomingPayload,
  OutgoingPayloadBytes,
  ContextBytesType,
} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientUpdatesByRange(
  protocol: ProtocolDescriptor<altair.LightClientUpdatesByRange, allForks.LightClientUpdate>,
  request: IncomingPayload<altair.LightClientUpdatesByRange>,
  chain: IBeaconChain
): AsyncIterable<OutgoingPayloadBytes> {
  const requestBody =
    request.type === PayloadType.ssz
      ? request.data
      : protocol.requestEncoder(chain.config.getForkName(chain.clock.currentSlot))?.deserialize(request.bytes);

  if (!requestBody) {
    throw new Error(`Invalid request for method=${protocol.method}, version=${protocol.version}`);
  }

  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (let period = requestBody.startPeriod; period < requestBody.startPeriod + count; period++) {
    try {
      const fork = chain.config.getForkName(chain.clock.currentSlot);
      yield {
        type: PayloadType.bytes,
        bytes: protocol.responseEncoder(fork).serialize(await chain.lightClientServer.getUpdate(period)),
        contextBytes: {
          type: ContextBytesType.ForkDigest,
          fork,
        },
      };
    } catch (e) {
      if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
        throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
      } else {
        throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
      }
    }
  }
}
