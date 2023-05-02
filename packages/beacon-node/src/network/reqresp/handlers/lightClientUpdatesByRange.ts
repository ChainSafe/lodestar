import {altair} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  ResponseOutgoing,
  LightClientServerError,
  LightClientServerErrorCode,
  ResponseError,
  RespStatus,
  ProtocolDescriptor,
} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientUpdatesByRange(
  protocol: ProtocolDescriptor,
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (let period = requestBody.startPeriod; period < requestBody.startPeriod + count; period++) {
    try {
      const update = await chain.lightClientServer.getUpdate(period);
      const fork = chain.config.getForkName(update.signatureSlot);

      yield {
        data: protocol.responseEncoder(fork).serialize(update),
        fork,
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
