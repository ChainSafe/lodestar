import {altair} from "@lodestar/types";
import {MAX_REQUEST_LIGHT_CLIENT_UPDATES} from "@lodestar/params";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";

export async function* onLightclientUpdate(
  requestBody: altair.LightClientUpdateByRange,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientUpdate[]> {
  try {
    const count = Math.min(MAX_REQUEST_LIGHT_CLIENT_UPDATES, requestBody.count);
    yield await chain.lightClientServer.getUpdates(requestBody.startPeriod, count);
  } catch (e) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
  }
}
