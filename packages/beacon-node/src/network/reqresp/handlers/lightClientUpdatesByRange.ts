import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  LightClientServerError,
  LightClientServerErrorCode,
  RespStatus,
  ResponseError,
  ResponseOutgoing,
} from "@lodestar/reqresp";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";

export async function* onLightClientUpdatesByRange(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (let period = requestBody.startPeriod; period < requestBody.startPeriod + count; period++) {
    try {
      const update = await chain.lightClientServer.getUpdate(period);
      const boundary = chain.config.getForkBoundaryAtEpoch(computeEpochAtSlot(update.signatureSlot));
      const type = responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange](boundary.fork, 0);

      yield {
        data: type.serialize(update),
        boundary,
      };
    } catch (e) {
      if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
        throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
      }
      throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
    }
  }
}
