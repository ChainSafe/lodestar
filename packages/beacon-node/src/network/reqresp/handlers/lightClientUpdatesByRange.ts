import {altair, allForks} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  EncodedPayload,
  EncodedPayloadType,
  LightClientServerError,
  LightClientServerErrorCode,
  ResponseError,
  RespStatus,
} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";

export async function* onLightClientUpdatesByRange(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<EncodedPayload<allForks.LightClientUpdate>> {
  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (let period = requestBody.startPeriod; period < requestBody.startPeriod + count; period++) {
    try {
      yield {
        type: EncodedPayloadType.ssz,
        data: await chain.lightClientServer.getUpdate(period),
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
