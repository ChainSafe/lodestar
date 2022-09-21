import {altair} from "@lodestar/types";
import {IBeaconChain} from "../../../chain/index.js";
import {ResponseError} from "../response/index.js";
import {RespStatus} from "../../../constants/index.js";

export async function* onLightclientUpdate(
  requestBody: altair.LightClientUpdateByRange,
  chain: IBeaconChain
): AsyncIterable<altair.LightClientUpdate[]> {
  try {
    yield await chain.lightClientServer.getUpdates(requestBody.startPeriod, requestBody.count);
  } catch (e) {
    throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, (e as Error).message);
  }
}
