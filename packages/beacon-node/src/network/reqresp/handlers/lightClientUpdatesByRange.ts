import {altair} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {
  ResponseOutgoing,
  LightClientServerError,
  LightClientServerErrorCode,
  ResponseError,
  RespStatus,
} from "@lodestar/reqresp";
import {IBeaconChain} from "../../../chain/index.js";
import {ReqRespMethod, responseSszTypeByMethod} from "../types.js";
import {assertLightClientServer} from "../../../node/utils/lightclient.js";

export async function* onLightClientUpdatesByRange(
  requestBody: altair.LightClientUpdatesByRange,
  chain: IBeaconChain
): AsyncIterable<ResponseOutgoing> {
  assertLightClientServer(chain.lightClientServer);

  const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
  for (let period = requestBody.startPeriod; period < requestBody.startPeriod + count; period++) {
    try {
      const update = await chain.lightClientServer.getUpdate(period);
      const fork = chain.config.getForkName(update.signatureSlot);
      const type = responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange](fork, 0);

      yield {
        data: type.serialize(update),
        fork,
      };
    } catch (e) {
      if ((e as LightClientServerError).type?.code === LightClientServerErrorCode.RESOURCE_UNAVAILABLE) {
        throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
      }
      throw new ResponseError(RespStatus.SERVER_ERROR, (e as Error).message);
    }
  }
}
